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

// "muted" ahora puede ser para siempre (muted_until vacío) o hasta una
// fecha concreta (1 hora / 8 horas / 1 semana — ver migration_v27.sql). Si
// ya ha pasado esa fecha, se considera que ya NO está silenciado, aunque la
// columna "muted" siga en true — el aviso de vencimiento se limpia solo la
// próxima vez que se abre la ficha/lista en la app, así que aquí hay que
// comprobarlo por fecha, no fiarse solo del booleano.
function isCurrentlyMuted(row: { muted?: boolean | null; muted_until?: string | null } | null | undefined): boolean {
  if (!row?.muted) return false
  if (!row.muted_until) return true
  return new Date(row.muted_until).getTime() > Date.now()
}

type PushPayload = {
  title: string
  body: string
  url?: string
  tag?: string
  // Foto de quien escribe (chat directo) o de la lista/grupo, si la tiene
  // puesta (ver migration_v21.sql) — se usa como icono del aviso en vez
  // del icono genérico de la app.
  icon?: string
  // Solo en avisos de chat: identifican la conversación para que el
  // Service Worker pueda ofrecer los botones de acción sin tener que abrir
  // la app (ver src/sw.ts).
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

  if (!profile || !profile.notify_push_enabled || !(profile as Record<string, boolean>)[field]) {
    // OJO: este log (y los de más abajo) son a propósito. Antes esta
    // función nunca contaba nada del "camino feliz" (ni de por qué se
    // descartaba un aviso ni de si el envío a un dispositivo concreto
    // fallaba) — solo el error inesperado del Database Webhook completo, si
    // es que llegaba a lanzarlo. Eso hacía imposible diagnosticar un caso
    // como "la función se ejecuta sin error, pero no llega nada al móvil":
    // en los registros (Logs) no había ni rastro de qué había pasado de
    // verdad con ESE envío en concreto.
    console.log(`[send-push] ${userId}: omitido — notify_push_enabled=${profile?.notify_push_enabled} ${field}=${profile ? (profile as Record<string, boolean>)[field] : 'perfil no encontrado'}`)
    return
  }

  const { data: subs } = await supabaseAdmin
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth')
    .eq('user_id', userId)

  if (!subs || subs.length === 0) {
    console.log(`[send-push] ${userId}: sin ninguna suscripción guardada (push_subscriptions vacío para este usuario)`)
    return
  }

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(payload),
        )
        console.log(`[send-push] ${userId}: enviado OK a ${sub.endpoint.slice(0, 70)}...`)
      } catch (err) {
        const statusCode = (err as { statusCode?: number })?.statusCode
        const body = (err as { body?: string })?.body
        console.error(
          `[send-push] ${userId}: FALLÓ el envío a ${sub.endpoint.slice(0, 70)}... — statusCode=${statusCode} body=${body} mensaje=${(err as Error)?.message}`,
        )
        if (statusCode === 404 || statusCode === 410) {
          await supabaseAdmin.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
        }
        // El resto de códigos (401/403 típicamente = claves VAPID que no
        // coinciden entre esta función y src/lib/push.ts, o "secrets" de
        // Supabase mal puestos) NO se limpian de la tabla — no es que el
        // dispositivo ya no exista, es que algo del lado del servidor está
        // mal configurado, y seguirá estándolo hasta corregirlo. El error
        // de arriba, en los Logs de la función, dice exactamente cuál de
        // las dos cosas es.
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
      supabaseAdmin.from('profiles').select('username, avatar_url').eq('id', senderId).maybeSingle(),
      supabaseAdmin
        .from('contacts')
        .select('muted, muted_until')
        .eq('user_id', toUserId)
        .eq('contact_user_id', senderId)
        .maybeSingle(),
    ])
    if (!sender || isCurrentlyMuted(myContactRow)) return

    const bodyText =
      (record.content as string | null) ||
      (record.image_path ? '📷 Foto' : null) ||
      (record.audio_path ? '🎤 Nota de voz' : '')
    await notifyUser(toUserId, 'notify_chat', {
      title: sender.username,
      body: bodyText,
      url: `/contacts/${senderId}/chat`,
      tag: `dm-${senderId}`,
      icon: sender.avatar_url || undefined,
      convType: 'dm',
      convId: senderId,
    })
    return
  }
  if (!listId) return

  const [{ data: list }, { data: sender }, { data: members }] = await Promise.all([
    supabaseAdmin.from('lists').select('name, photo_url').eq('id', listId).maybeSingle(),
    supabaseAdmin.from('profiles').select('username').eq('id', senderId).maybeSingle(),
    supabaseAdmin
      .from('list_members')
      .select('user_id, muted, muted_until')
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
    // Si la lista tiene foto puesta (ver migration_v21.sql), se usa como
    // icono del aviso — como el icono de un grupo en WhatsApp. Si no,
    // showNotification se queda con el icono de la app (ver src/sw.ts).
    icon: list.photo_url || undefined,
    convType: 'list',
    convId: listId,
  }
  // Quien tenga silenciado el chat DE ESTA LISTA (ver migration_v15.sql y,
  // para la duración, migration_v27.sql) no recibe el aviso, aunque tenga
  // notify_chat activado en general.
  await Promise.all(
    members.filter((m) => !isCurrentlyMuted(m)).map((m) => notifyUser(m.user_id as string, 'notify_chat', payload)),
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
