// Edge Function: send-push
//
// La llama un Database Webhook de Supabase cada vez que se inserta una fila
// en "messages", "expenses", "list_members" (invitaciones) o "settlements"
// (pagos pendientes de confirmar). Decide a quién avisar según sus
// preferencias de notificaciones (columnas notify_* en profiles) y les
// manda un aviso push de verdad (llega aunque tengan la app/el móvil
// cerrados) a cada uno de sus dispositivos suscritos.
//
// Variables de entorno que hacen falta (se configuran como "secrets" del
// proyecto de Supabase — Project Settings → Edge Functions → Secrets, o con
// `supabase secrets set`):
//   VAPID_PUBLIC_KEY   — la misma que hay puesta en src/lib/push.ts
//   VAPID_PRIVATE_KEY  — la pareja privada, NUNCA va en el código del cliente
//   VAPID_SUBJECT       — un "mailto:tu-correo@ejemplo.com" (lo exige el estándar Web Push)
//   WEBHOOK_SECRET      — una cadena cualquiera inventada por ti, para que
//                         nadie más pueda llamar a esta función y mandar
//                         avisos falsos. El Database Webhook debe mandarla
//                         en la cabecera "x-webhook-secret".
// SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY los pone Supabase automáticamente,
// no hace falta configurarlos a mano.

import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY')!
const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY')!
const vapidSubject = Deno.env.get('VAPID_SUBJECT')!
const webhookSecret = Deno.env.get('WEBHOOK_SECRET')

webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey)

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey)

type NotifyField = 'notify_chat' | 'notify_expenses' | 'notify_invites' | 'notify_settlements'

type PushPayload = {
  title: string
  body: string
  url?: string
  tag?: string
  // Solo en avisos de chat: identifican la conversación para que el
  // Service Worker pueda ofrecer el botón "Marcar como leído" sin tener
  // que abrir la app (ver src/sw.ts).
  convType?: 'list' | 'dm'
  convId?: string
}

// Manda el aviso a TODOS los dispositivos suscritos de un usuario, si su
// interruptor general y el de este tipo de aviso concreto están activados.
// Si un dispositivo ya no existe (la persona desinstaló la app, borró
// datos, etc.) Web Push devuelve 404/410 — en ese caso borramos esa
// suscripción para no seguir intentando mandarle cosas que nunca van a
// llegar.
async function notifyUser(userId: string, field: NotifyField, payload: PushPayload) {
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select(`notify_push_enabled, ${field}`)
    .eq('id', userId)
    .maybeSingle()

  if (!profile || !profile.notify_push_enabled || !(profile as Record<string, boolean>)[field]) return

  const { data: subs } = await supabaseAdmin
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth')
    .eq('user_id', userId)

  if (!subs || subs.length === 0) return

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(payload),
        )
      } catch (err) {
        const statusCode = (err as { statusCode?: number })?.statusCode
        if (statusCode === 404 || statusCode === 410) {
          await supabaseAdmin.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
        }
        // Otros errores (red, VAPID mal configurado, etc.) se ignoran a
        // propósito: que falle el aviso a UN dispositivo no debe tumbar el
        // resto de avisos a otras personas.
      }
    }),
  )
}

async function handleMessages(record: Record<string, unknown>) {
  const listId = record.list_id as string | null
  const toUserId = record.to_user_id as string | null
  const senderId = record.sender_id as string | null
  if (!senderId) return

  // Mensaje directo (sin lista de por medio) — ver migration_v18.sql. Un
  // solo destinatario, así que no hace falta consultar list_members: se
  // mira directamente si el destinatario tiene silenciada esa conversación
  // en su propia fila de "contacts".
  if (!listId && toUserId) {
    const [{ data: sender }, { data: myContactRow }] = await Promise.all([
      supabaseAdmin.from('profiles').select('username').eq('id', senderId).maybeSingle(),
      supabaseAdmin
        .from('contacts')
        .select('muted')
        .eq('user_id', toUserId)
        .eq('contact_user_id', senderId)
        .maybeSingle(),
    ])
    if (!sender || myContactRow?.muted) return

    const bodyText =
      (record.content as string | null) ||
      (record.image_path ? '📷 Foto' : null) ||
      (record.audio_path ? '🎤 Nota de voz' : '')
    await notifyUser(toUserId, 'notify_chat', {
      title: sender.username,
      body: bodyText,
      url: `/contacts/${senderId}/chat`,
      tag: `dm-${senderId}`,
      convType: 'dm',
      convId: senderId,
    })
    return
  }
  if (!listId) return

  const [{ data: list }, { data: sender }, { data: members }] = await Promise.all([
    supabaseAdmin.from('lists').select('name').eq('id', listId).maybeSingle(),
    supabaseAdmin.from('profiles').select('username').eq('id', senderId).maybeSingle(),
    supabaseAdmin
      .from('list_members')
      .select('user_id, muted')
      .eq('list_id', listId)
      .eq('status', 'accepted')
      .neq('user_id', senderId),
  ])
  if (!list || !sender || !members) return

  const bodyText =
      (record.content as string | null) ||
      (record.image_path ? '📷 Foto' : null) ||
      (record.audio_path ? '🎤 Nota de voz' : '')
  const payload: PushPayload = {
    title: list.name,
    body: `${sender.username}: ${bodyText}`,
    url: `/lists/${listId}?tab=chat`,
    tag: `chat-${listId}`,
    convType: 'list',
    convId: listId,
  }
  // Quien tenga silenciado el chat DE ESTA LISTA (ver migration_v15.sql) no
  // recibe el aviso, aunque tenga notify_chat activado en general.
  await Promise.all(
    members.filter((m) => !m.muted).map((m) => notifyUser(m.user_id as string, 'notify_chat', payload)),
  )
}

async function handleExpenses(record: Record<string, unknown>) {
  if (record.is_draft) return
  const listId = record.list_id as string
  const createdBy = record.created_by as string | null
  if (!createdBy) return

  const [{ data: list }, { data: creator }, { data: members }] = await Promise.all([
    supabaseAdmin.from('lists').select('name, currency').eq('id', listId).maybeSingle(),
    supabaseAdmin.from('profiles').select('username').eq('id', createdBy).maybeSingle(),
    supabaseAdmin
      .from('list_members')
      .select('user_id')
      .eq('list_id', listId)
      .eq('status', 'accepted')
      .neq('user_id', createdBy),
  ])
  if (!list || !creator || !members) return

  const amount = Number(record.total_amount)
  const description = (record.description as string | null) || (record.category as string)
  const payload: PushPayload = {
    title: list.name,
    body: `${creator.username} añadió un gasto de ${amount.toFixed(2)} ${list.currency} — ${description}`,
    url: `/lists/${listId}?tab=gastos`,
    tag: `expense-${listId}`,
  }
  await Promise.all(members.map((m) => notifyUser(m.user_id as string, 'notify_expenses', payload)))
}

async function handleListMembers(record: Record<string, unknown>) {
  if (record.status !== 'invited') return
  const listId = record.list_id as string
  const userId = record.user_id as string

  const { data: list } = await supabaseAdmin.from('lists').select('name').eq('id', listId).maybeSingle()
  if (!list) return

  await notifyUser(userId, 'notify_invites', {
    title: 'NoteUs',
    body: `Te han invitado a "${list.name}"`,
    url: `/lists/${listId}`,
    tag: `invite-${listId}`,
  })
}

async function handleSettlements(record: Record<string, unknown>) {
  // Solo interesa el caso "pendiente de confirmar" (ver migration_v11.sql):
  // lo registró el deudor (from_user) y todavía no lo ha confirmado quien
  // cobra (to_user). Si ya viene confirmado (lo registró to_user), no hay
  // nada que nadie tenga que confirmar, así que no se avisa.
  if (record.confirmed_at) return
  const createdBy = record.created_by as string | null
  const fromUser = record.from_user as string | null
  const toUser = record.to_user as string | null
  if (!toUser || createdBy !== fromUser) return

  const listId = record.list_id as string
  const [{ data: list }, { data: from }] = await Promise.all([
    supabaseAdmin.from('lists').select('name, currency').eq('id', listId).maybeSingle(),
    supabaseAdmin.from('profiles').select('username').eq('id', fromUser as string).maybeSingle(),
  ])
  if (!list || !from) return

  const amount = Number(record.amount)
  await notifyUser(toUser, 'notify_settlements', {
    title: list.name,
    body: `${from.username} dice haberte pagado ${amount.toFixed(2)} ${list.currency} — confírmalo`,
    url: `/lists/${listId}?tab=gastos`,
    tag: `settlement-${listId}`,
  })
}

Deno.serve(async (req) => {
  if (webhookSecret && req.headers.get('x-webhook-secret') !== webhookSecret) {
    return new Response('unauthorized', { status: 401 })
  }

  let body: { type?: string; table?: string; record?: Record<string, unknown> }
  try {
    body = await req.json()
  } catch {
    return new Response('bad request', { status: 400 })
  }

  if (body.type !== 'INSERT' || !body.record) {
    return new Response('ignored', { status: 200 })
  }

  try {
    switch (body.table) {
      case 'messages':
        await handleMessages(body.record)
        break
      case 'expenses':
        await handleExpenses(body.record)
        break
      case 'list_members':
        await handleListMembers(body.record)
        break
      case 'settlements':
        await handleSettlements(body.record)
        break
    }
  } catch (err) {
    console.error('send-push error', err)
    // Devolvemos 200 igualmente: si Supabase reintenta webhooks fallidos,
    // no queremos que un error puntual (por ejemplo, VAPID mal configurado)
    // provoque reintentos infinitos que además duplicarían avisos ya
    // mandados con éxito antes del fallo.
  }

  return new Response('ok', { status: 200 })
})
