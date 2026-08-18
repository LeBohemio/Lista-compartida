/// <reference lib="webworker" />

// Service Worker escrito a mano (en vez de generado automáticamente) porque
// necesitamos reaccionar a los eventos "push" y "notificationclick" del
// navegador para las notificaciones push de verdad — eso no lo cubre el
// modo generateSW anterior. self.__WB_MANIFEST lo rellena vite-plugin-pwa
// en el build con la lista de archivos a cachear (mismo comportamiento de
// caché que antes, solo que ahora el propio Service Worker está escrito
// aquí en vez de generado).
declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null } | string>
}

// tsconfig.sw.json (deliberadamente) no incluye "types": ["vite/client"] —
// ver el comentario de arriba sobre por qué sw.ts se compila en su propio
// proyecto de TypeScript — así que import.meta.env no tiene tipo aquí sin
// esto. Vite sí sustituye estos valores en tiempo de build igual que en el
// resto de la app (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY ya se usan
// así en src/lib/supabaseClient.ts).
declare global {
  interface ImportMeta {
    env: {
      VITE_SUPABASE_URL?: string
      VITE_SUPABASE_ANON_KEY?: string
    }
  }
}

// El API de "botones de acción" en una notificación (NotificationAction,
// el campo "actions" de las opciones, y el campo "action" del evento
// notificationclick) es un estándar real y todos los navegadores con
// soporte de Web Push lo implementan, pero el lib.dom.d.ts que trae
// TypeScript no lo incluye todavía — lo definimos a mano.
//
// El campo "reply" (para el botón "Responder" con caja de texto integrada,
// tipo "type: 'text'") es más nuevo y solo lo soportan Chrome/Edge en
// Android y escritorio — en un navegador que no lo entienda, esa acción se
// muestra igualmente como botón normal (sin caja de texto) y, al tocarla,
// event.reply llega vacío; el código de más abajo trata ese caso abriendo
// la conversación en la app, igual que si se hubiera tocado el aviso.
interface NotificationAction {
  action: string
  title: string
  icon?: string
  type?: 'text'
  placeholder?: string
}
type ExtendedNotificationOptions = NotificationOptions & { actions?: NotificationAction[] }
declare global {
  interface NotificationEvent {
    reply?: string
  }
}

import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching'
import { registerRoute } from 'workbox-routing'
import { CacheFirst } from 'workbox-strategies'
import { ExpirationPlugin } from 'workbox-expiration'
import { CacheableResponsePlugin } from 'workbox-cacheable-response'

precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

// registerType: 'autoUpdate' — el Service Worker nuevo toma el control en
// cuanto está listo, sin esperar a que se cierren todas las pestañas
// abiertas de la app.
self.skipWaiting()
self.addEventListener('activate', () => {
  void self.clients.claim()
})

// El motor de OCR (worker + wasm + datos de idioma) pesa varios MB: no se
// precachea al instalar, se descarga la primera vez que se usa y a partir
// de ahí queda cacheado.
registerRoute(
  ({ url }) => /\/(tesseract|tesseract-core|tessdata)\/.*/i.test(url.pathname),
  new CacheFirst({
    cacheName: 'ocr-engine-assets',
    plugins: [
      new ExpirationPlugin({ maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 180 }),
      new CacheableResponsePlugin({ statuses: [0, 200] }),
    ],
  }),
)

// Los avatares prediseñados (~7MB en total) tampoco se precachean: se
// descargan (y cachean) bajo demanda, solo si la persona abre el selector.
registerRoute(
  ({ url }) => /\/avatars\/.*/i.test(url.pathname),
  new CacheFirst({
    cacheName: 'preset-avatars',
    plugins: [
      new ExpirationPlugin({ maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 365 }),
      new CacheableResponsePlugin({ statuses: [0, 200] }),
    ],
  }),
)

// --- Sesión guardada para poder actuar en segundo plano ---
//
// El botón "Marcar como leído" de una notificación (ver más abajo) necesita
// poder escribir en la base de datos SIN abrir la app — si no hay ninguna
// pestaña abierta, el Service Worker no tiene acceso al cliente de Supabase
// de la página (que guarda la sesión en localStorage, que un Service Worker
// no puede leer). La solución: la app, cada vez que su sesión cambia
// (entrar, salir, refresco automático del token), se lo cuenta al Service
// Worker por postMessage (ver src/context/AuthContext.tsx), y aquí lo
// guardamos en IndexedDB (eso sí es accesible desde el Service Worker) para
// poder usarlo luego aunque la página esté cerrada.
const AUTH_DB_NAME = 'noteus-sw-auth'
const AUTH_STORE_NAME = 'session'
const AUTH_KEY = 'current'

type StoredSession = {
  accessToken: string
  refreshToken: string
  expiresAt: number // epoch en segundos
  userId: string
  language: 'es' | 'en'
}

function openAuthDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(AUTH_DB_NAME, 1)
    req.onupgradeneeded = () => {
      req.result.createObjectStore(AUTH_STORE_NAME)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function saveStoredSession(session: StoredSession | null) {
  const db = await openAuthDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(AUTH_STORE_NAME, 'readwrite')
    if (session) tx.objectStore(AUTH_STORE_NAME).put(session, AUTH_KEY)
    else tx.objectStore(AUTH_STORE_NAME).delete(AUTH_KEY)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}

async function loadStoredSession(): Promise<StoredSession | null> {
  const db = await openAuthDb()
  const session = await new Promise<StoredSession | null>((resolve, reject) => {
    const tx = db.transaction(AUTH_STORE_NAME, 'readonly')
    const req = tx.objectStore(AUTH_STORE_NAME).get(AUTH_KEY)
    req.onsuccess = () => resolve((req.result as StoredSession | undefined) ?? null)
    req.onerror = () => reject(req.error)
  })
  db.close()
  return session
}

self.addEventListener('message', (event: ExtendableMessageEvent) => {
  const msg = event.data as { type?: string; session?: StoredSession | null } | undefined
  if (msg?.type === 'AUTH_SESSION') {
    event.waitUntil(saveStoredSession(msg.session ?? null))
  }
})

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string

// El access token dura poco (normalmente 1h) — si la app lleva cerrada más
// tiempo que eso, hay que renovarlo con el refresh token antes de poder usar
// la API de Supabase, igual que hace el propio supabase-js dentro de la app.
async function refreshStoredSession(session: StoredSession): Promise<StoredSession | null> {
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
      body: JSON.stringify({ refresh_token: session.refreshToken }),
    })
    if (!res.ok) return null
    const json = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number }
    if (!json.access_token || !json.refresh_token) return null
    const next: StoredSession = {
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      expiresAt: Math.floor(Date.now() / 1000) + (json.expires_in ?? 3600),
      userId: session.userId,
      language: session.language,
    }
    await saveStoredSession(next)
    return next
  } catch {
    return null
  }
}

// Sesión válida para hacer una llamada ahora mismo — la carga de IndexedDB
// y, si el token ya caducó (o está a punto), la renueva primero. Null si no
// hay sesión guardada o si la renovación falla (por ejemplo, sin conexión).
async function getValidSession(): Promise<StoredSession | null> {
  let session = await loadStoredSession()
  if (!session) return null
  const nowSeconds = Math.floor(Date.now() / 1000)
  if (session.expiresAt - 60 < nowSeconds) {
    session = await refreshStoredSession(session)
  }
  return session
}

// PATCH genérico sobre la fila que representa "mi vista de esta
// conversación" — list_members (lista) o contacts (directo) — usada tanto
// para "Marcar como leído" como para "Silenciar". Si algo falla (no hay
// sesión, no se pudo renovar el token, sin conexión...) no se marca nada:
// la persona siempre puede hacerlo a mano abriendo la app.
async function patchConversation(convType: 'list' | 'dm', convId: string, body: Record<string, unknown>) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return
  const session = await getValidSession()
  if (!session) return

  const restUrl =
    convType === 'list'
      ? `${SUPABASE_URL}/rest/v1/list_members?list_id=eq.${convId}&user_id=eq.${session.userId}`
      : `${SUPABASE_URL}/rest/v1/contacts?user_id=eq.${session.userId}&contact_user_id=eq.${convId}`

  await fetch(restUrl, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${session.accessToken}`,
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(body),
  }).catch(() => {
    // sin conexión u otro fallo de red: se queda sin aplicar.
  })
}

async function markConversationRead(convType: 'list' | 'dm', convId: string) {
  await patchConversation(convType, convId, { last_read_message_at: new Date().toISOString() })
}

async function muteConversation(convType: 'list' | 'dm', convId: string) {
  await patchConversation(convType, convId, { muted: true })
}

// Manda el texto escrito en el propio botón "Responder" de la notificación
// (Chrome/Edge en Android y escritorio) como un mensaje normal de chat, sin
// abrir la app — igual que WhatsApp. Al responder, de paso se marca la
// conversación como leída (igual que en WhatsApp: si has contestado, la has
// leído).
async function sendReplyMessage(convType: 'list' | 'dm', convId: string, content: string) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return
  const session = await getValidSession()
  if (!session) return

  const insertBody =
    convType === 'list'
      ? { list_id: convId, to_user_id: null, sender_id: session.userId, content }
      : { list_id: null, to_user_id: convId, sender_id: session.userId, content }

  await fetch(`${SUPABASE_URL}/rest/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${session.accessToken}`,
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(insertBody),
  }).catch(() => {
    // sin conexión u otro fallo de red: el mensaje no llega a mandarse. No
    // hay forma de avisar de esto sin abrir una ventana, así que se queda
    // así — es el mismo riesgo que tiene cualquier envío desde una
    // notificación en cualquier app.
  })

  await patchConversation(convType, convId, { last_read_message_at: new Date().toISOString() })
}

// --- Notificaciones push ---
//
// El payload lo manda nuestra Edge Function (supabase/functions/send-push)
// como JSON: { title, body, url, tag, convType, convId }. "url" es a dónde
// navegar al tocar el aviso (por ejemplo, directo al chat de la lista en
// cuestión); "tag" agrupa avisos relacionados (si llegan dos del mismo chat
// seguidos, el segundo sustituye al primero en vez de amontonarse).
// "convType"/"convId" solo vienen en avisos de chat (lista o directo) e
// identifican la conversación, para poder ofrecer los botones de acción sin
// tener que abrir la app. "icon" es la foto de quien escribe (o de la
// lista/grupo, si la tiene puesta) — si no viene, se usa el icono de la
// app como hasta ahora.
type PushPayload = {
  title: string
  body: string
  url?: string
  tag?: string
  icon?: string
  convType?: 'list' | 'dm'
  convId?: string
}

const ACTION_LABELS = {
  es: { reply: 'Responder', markRead: 'Marcar como leído', mute: 'Silenciar' },
  en: { reply: 'Reply', markRead: 'Mark as read', mute: 'Mute' },
}

self.addEventListener('push', (event: PushEvent) => {
  let payload: PushPayload = { title: 'NoteUs', body: '' }
  try {
    if (event.data) payload = { ...payload, ...event.data.json() }
  } catch {
    // Si el payload no es JSON válido, nos quedamos con el aviso genérico
    // en vez de fallar en silencio y no mostrar nada.
  }

  event.waitUntil(
    (async () => {
      let actions: NotificationAction[] | undefined
      if (payload.convType && payload.convId) {
        const stored = await loadStoredSession()
        const lang = stored?.language ?? 'es'
        const labels = ACTION_LABELS[lang]
        // Mismo orden que WhatsApp: responder, marcar como leído, silenciar.
        // "Responder" ya NO pide el campo de texto integrado (type: 'text')
        // — en el móvil donde lo probamos, ese campo hacía que el propio
        // navegador descartase el botón entero (ni siquiera se veía como
        // botón normal), dejando solo uno de los otros dos visibles. Como
        // botón normal, "Responder" simplemente abre la conversación lista
        // para escribir — se pierde la caja de texto dentro del aviso, pero
        // el botón en sí es mucho más probable que se vea.
        actions = [
          { action: 'reply', title: labels.reply },
          { action: 'mark-read', title: labels.markRead },
          { action: 'mute', title: labels.mute },
        ]
      }

      const options: ExtendedNotificationOptions = {
        body: payload.body,
        icon: payload.icon || '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        tag: payload.tag,
        data: { url: payload.url || '/', convType: payload.convType, convId: payload.convId },
        actions,
      }
      await self.registration.showNotification(payload.title, options)
    })(),
  )
})

self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close()
  const data = event.notification.data as
    | { url?: string; convType?: 'list' | 'dm'; convId?: string }
    | undefined

  if (event.action === 'mark-read') {
    if (data?.convType && data?.convId) {
      event.waitUntil(markConversationRead(data.convType, data.convId))
    }
    return
  }

  if (event.action === 'mute') {
    if (data?.convType && data?.convId) {
      event.waitUntil(muteConversation(data.convType, data.convId))
    }
    return
  }

  const reply = event.reply?.trim()
  if (event.action === 'reply' && reply && data?.convType && data?.convId) {
    event.waitUntil(sendReplyMessage(data.convType, data.convId, reply))
    return
  }

  // Toque normal sobre el aviso, o "Responder" en un navegador que no
  // soporta la caja de texto integrada (reply vacío): abrir/enfocar la app
  // en la conversación, como hasta ahora.
  //
  // URL absoluta (no relativa): clients.openWindow() debería resolver bien
  // una ruta relativa contra el origen del Service Worker, pero no todos
  // los navegadores/webviews lo hacen igual de bien — quitamos esa
  // ambigüedad de en medio.
  const targetUrl = new URL(data?.url || '/', self.location.origin).toString()

  event.waitUntil(
    (async () => {
      // clients.openWindow() solo puede abrir una ventana nueva mientras
      // sigue "vivo" el gesto de haber tocado el aviso — si de por medio
      // pasan varios pasos asíncronos que fallan, el navegador puede acabar
      // rechazándolo en silencio. Por eso aquí NO se intenta "reutilizar
      // pestaña" con reintentos encadenados: se mira una sola vez si hay
      // alguna pestaña abierta y, si no la hay (o falla), se va derecho a
      // abrir una ventana nueva, sin pasos de más entre medias.
      let handled = false
      try {
        const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
        const existing = allClients.find((c) => 'focus' in c)
        if (existing) {
          const focused = await existing.focus()
          if ('navigate' in focused) await (focused as WindowClient).navigate(targetUrl)
          handled = true
        }
      } catch {
        // no había pestaña utilizable, o algo falló al reutilizarla —
        // caemos a abrir una ventana nueva de todos modos.
      }
      if (!handled) {
        await self.clients.openWindow(targetUrl).catch(() => {})
      }
    })(),
  )
})
