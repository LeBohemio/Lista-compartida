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

// --- Notificaciones push ---
//
// El payload lo manda nuestra Edge Function (supabase/functions/send-push)
// como JSON: { title, body, url, tag }. "url" es a dónde navegar al tocar
// el aviso (por ejemplo, directo al chat de la lista en cuestión); "tag"
// agrupa avisos relacionados (si llegan dos del mismo chat seguidos, el
// segundo sustituye al primero en vez de amontonarse).
type PushPayload = {
  title: string
  body: string
  url?: string
  tag?: string
}

self.addEventListener('push', (event: PushEvent) => {
  let payload: PushPayload = { title: 'Listas en Común', body: '' }
  try {
    if (event.data) payload = { ...payload, ...event.data.json() }
  } catch {
    // Si el payload no es JSON válido, nos quedamos con el aviso genérico
    // en vez de fallar en silencio y no mostrar nada.
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: payload.tag,
      data: { url: payload.url || '/' },
    }),
  )
})

self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close()
  const targetUrl = (event.notification.data as { url?: string } | undefined)?.url || '/'

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      // Si ya hay una pestaña de la app abierta, la reutilizamos y la
      // llevamos a la URL del aviso en vez de abrir una ventana nueva.
      for (const client of allClients) {
        if ('focus' in client) {
          await client.focus()
          if ('navigate' in client) await (client as WindowClient).navigate(targetUrl)
          return
        }
      }
      await self.clients.openWindow(targetUrl)
    })(),
  )
})
