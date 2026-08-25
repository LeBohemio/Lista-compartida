import { supabase } from './supabaseClient'

// La clave pública VAPID no es secreta (va incluida en cada suscripción y
// cualquiera puede verla inspeccionando la app) — solo identifica que los
// avisos que llegan de verdad los mandó nuestro servidor. La privada NO va
// aquí: esa solo la conoce la Edge Function (como variable de entorno /
// secreto de Supabase), nunca el navegador. Si algún día se regeneran las
// claves, hay que cambiar esta constante Y el secreto de la función a la
// vez, o dejarán de coincidir y todas las suscripciones existentes dejarán
// de funcionar (habrá que volver a activar las notificaciones).
export const VAPID_PUBLIC_KEY = 'BCaB1l35YbexCy7Lj8o7pUz2Aq4nW5HsSXVncXoKTSTTvWrn-RHX9gFBDCv8d1zpRqlcS0F1w0Vt6RzX_rLrDcQ'

export function isPushSupported() {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i)
  return outputArray
}

/** true si el navegador ya tiene el permiso de notificaciones concedido (no dice nada de si hay suscripción activa). */
export function notificationPermission(): NotificationPermission | 'unsupported' {
  if (!isPushSupported()) return 'unsupported'
  return Notification.permission
}

/**
 * Pide permiso (si hace falta), crea la suscripción push del navegador y la
 * guarda en push_subscriptions. Marca notify_push_enabled = true en el
 * perfil. Lanza un error con mensaje legible si el permiso se deniega o el
 * navegador no soporta notificaciones push.
 */
export async function enablePush(userId: string) {
  if (!isPushSupported()) throw new Error('unsupported')

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('denied')

  const registration = await navigator.serviceWorker.ready
  let subscription = await registration.pushManager.getSubscription()
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    })
  }

  const json = subscription.toJSON()
  const endpoint = json.endpoint
  const p256dh = json.keys?.p256dh
  const auth = json.keys?.auth
  if (!endpoint || !p256dh || !auth) throw new Error('invalid_subscription')

  // upsert por endpoint: si este mismo dispositivo ya tenía una fila (por
  // ejemplo, la persona desactivó y volvió a activar), la reemplaza en vez
  // de duplicarla.
  const { error } = await supabase
    .from('push_subscriptions')
    .upsert({ user_id: userId, endpoint, p256dh, auth }, { onConflict: 'endpoint' })
  if (error) throw error

  const { error: profileErr } = await supabase.from('profiles').update({ notify_push_enabled: true }).eq('id', userId)
  if (profileErr) throw profileErr
}

/**
 * Da de baja la suscripción de ESTE navegador/dispositivo: la cancela a
 * nivel del propio navegador y borra su fila en push_subscriptions. Marca
 * notify_push_enabled = false en el perfil (afecta a todos los
 * dispositivos de la persona, no solo a este — es la casilla general).
 */
export async function disablePush(userId: string) {
  const { error: profileErr } = await supabase.from('profiles').update({ notify_push_enabled: false }).eq('id', userId)
  if (profileErr) throw profileErr

  if (!isPushSupported()) return
  try {
    const registration = await navigator.serviceWorker.ready
    const subscription = await registration.pushManager.getSubscription()
    if (subscription) {
      await supabase.from('push_subscriptions').delete().eq('endpoint', subscription.endpoint)
      await subscription.unsubscribe()
    }
  } catch {
    // Si el navegador no coopera al dar de baja localmente, no pasa nada
    // grave: el interruptor general en el perfil ya está apagado, así que
    // la Edge Function no le manda nada aunque quedara algún resto de
    // suscripción por ahí.
  }
}
