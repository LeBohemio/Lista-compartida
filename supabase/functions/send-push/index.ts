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

// Texto corto para un mensaje dentro del aviso — lo mismo que se ve en la
// propia burbuja del chat cuando no hay texto (foto/nota de voz), pero en
// una línea. Se usa tanto para el mensaje que acaba de llegar como para los
// anteriores que se añaden debajo (ver HISTORY_LINES más abajo).
function messagePreview(m: { content?: unknown; image_path?: unknown; audio_path?: unknown }): string {
  return (m.content as string | null) || (m.image_path ? '📷 Foto' : null) || (m.audio_path ? '🎤 Nota de voz' : '') || ''
}

// Cuántos mensajes como mucho se apilan dentro de un mismo aviso. Android
// (y por tanto Chrome) ya sabe mostrar un cuerpo de varias líneas como un
// aviso "expandible" — solo enseña la última línea hasta que lo despliegas
// (deslizando hacia abajo con dos dedos o manteniendo pulsado), y entonces
// se ven todas — así que basta con mandar varias líneas en "body" para que
// se comporte igual que el resumen de mensajes de WhatsApp al desplegar,
// aunque aquí sea solo texto plano (sin burbujas ni foto por línea, eso sí
// es un estilo nativo de Android que no está al alcance de una web).
const HISTORY_LINES = 4

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

    // Los últimos mensajes que ESTA persona te ha mandado a ti, del más
    // antiguo al más reciente — si llegan varios seguidos (lo típico:
    // alguien escribe 3-4 líneas sueltas en vez de una), el aviso los
    // apila todos en vez de ir sustituyendo el anterior por el siguiente y
    // dejar solo el último visible. Si por lo que sea esta consulta falla,
    // no rompe el aviso: se sigue mandando igualmente, solo que con el
    // mensaje suelto de siempre.
    const { data: history } = await supabaseAdmin
      .from('messages')
      .select('content, image_path, audio_path')
      .eq('sender_id', senderId)
      .eq('to_user_id', toUserId)
      .order('created_at', { ascending: false })
      .limit(HISTORY_LINES)
    const bodyText = history && history.length > 0 ? history.reverse().map(messagePreview).join('\n') : messagePreview(record)
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

  // Igual que en el mensaje directo (ver comentario de más arriba), pero
  // aquí puede escribir más de una persona — así que cada línea lleva
  // delante quién la mandó, igual que ya se hacía con el mensaje suelto.
  let bodyText = `${sender.username}: ${messagePreview(record)}`
  const { data: history } = await supabaseAdmin
    .from('messages')
    .select('sender_id, content, image_path, audio_path')
    .eq('list_id', listId)
    .order('created_at', { ascending: false })
    .limit(HISTORY_LINES)
  if (history && history.length > 0) {
    const senderIds = [...new Set(history.map((m) => m.sender_id as string))]
    const { data: authors } = await supabaseAdmin.from('profiles').select('id, username').in('id', senderIds)
    const nameById = new Map((authors ?? []).map((a) => [a.id, a.username as string]))
    bodyText = history
      .reverse()
      .map((m) => `${nameById.get(m.sender_id as string) ?? sender.username}: ${messagePreview(m)}`)
      .join('\n')
  }
  const payload: PushPayload = {
    title: list.name,
    body: bodyText,
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

// Invitación a una nota compartida (Notas comunes) — mismo patrón que
// handleListMembers, pero mirando la tabla "notes" en vez de "lists". Antes
// de esto, invitar a alguien a una nota no mandaba ningún aviso push (solo
// las invitaciones a listas lo hacían) — ver migration_v40.sql para el
// trigger que hacía falta añadir.
async function handleNoteMembers(record: Record<string, unknown>) {
  if (record.status !== 'invited') {
    console.log(`[send-push] note_members: ignorado, status=${record.status}`)
    return
  }
  const noteId = record.note_id as string
  const userId = record.user_id as string

  const { data: note } = await supabaseAdmin.from('notes').select('title').eq('id', noteId).maybeSingle()
  if (!note) {
    console.log(`[send-push] note_members: no se encontró la nota ${noteId}`)
    return
  }

  await notifyUser(userId, 'notify_invites', {
    title: 'NoteUs',
    body: `Te han invitado a "${note.title}"`,
    url: `/notes/${noteId}`,
    tag: `invite-note-${noteId}`,
  })
}

// Petición de contacto ("amistad") recibida — ver migration_v17.sql
// (contact_requests) y migration_v42.sql (el trigger que llama a esto).
// Reutiliza la preferencia notify_invites en vez de crear una nueva: es la
// misma idea que una invitación a lista/nota (alguien quiere conectar
// contigo), y así no hace falta ni una columna ni un interruptor nuevo en
// Ajustes.
async function handleContactRequest(record: Record<string, unknown>) {
  if (record.status !== 'pending') {
    console.log(`[send-push] contact_requests: ignorado, status=${record.status}`)
    return
  }
  const fromUserId = record.from_user_id as string
  const toUserId = record.to_user_id as string

  const { data: sender } = await supabaseAdmin.from('profiles').select('username').eq('id', fromUserId).maybeSingle()
  if (!sender) {
    console.log(`[send-push] contact_requests: no se encontró el perfil ${fromUserId}`)
    return
  }

  await notifyUser(toUserId, 'notify_invites', {
    title: 'NoteUs',
    body: `${sender.username} quiere ser tu contacto`,
    url: `/contacts`,
    tag: `contact-request-${fromUserId}`,
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
  // Antes, si WEBHOOK_SECRET no estaba configurado en Supabase, esta
  // comprobación se saltaba entera (webhookSecret quedaba "falsy" y el "&&"
  // cortaba ahí) — cualquiera podía llamar a esta función sin cabecera
  // ninguna y colarle avisos falsos. Ahora, si falta la variable de entorno,
  // se rechaza la petición en vez de dejarla pasar sin comprobar nada.
  if (!webhookSecret || req.headers.get('x-webhook-secret') !== webhookSecret) {
    return new Response('unauthorized', { status: 401 })
  }

  let body: { type?: string; table?: string; record?: Record<string, unknown> }
  try {
    body = await req.json()
  } catch {
    return new Response('bad request', { status: 400 })
  }

  // Este log de aquí es a propósito, para poder ver en los Logs de la
  // función (Supabase → Edge Functions → send-push → Logs, NO la pestaña
  // "Invocations" — esa solo enseña que la petición HTTP llegó y con qué
  // código respondió, no lo que pasó dentro) exactamente qué tabla y qué
  // tipo de evento llegó en cada aviso.
  console.log(`[send-push] recibido: table=${body.table} type=${body.type}`)

  if (body.type !== 'INSERT' || !body.record) {
    console.log('[send-push] ignorado: no es un INSERT o no trae "record"')
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
      case 'note_members':
        await handleNoteMembers(body.record)
        break
      case 'contact_requests':
        await handleContactRequest(body.record)
        break
      case 'settlements':
        await handleSettlements(body.record)
        break
      default:
        console.log(`[send-push] tabla sin manejar: ${body.table}`)
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
