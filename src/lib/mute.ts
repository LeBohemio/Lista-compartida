// Ayudas compartidas para "silenciar con duración" (contactos y chat de
// listas) — ver migration_v27.sql. Antes "muted" era todo o nada; ahora
// puede tener fecha de caducidad ("muted_until"), así que en vez de mirar
// solo la columna booleana hay que comprobar también si esa fecha ya pasó.

export type MuteDuration = '1h' | '8h' | '1w' | 'always'

const DURATION_MS: Record<Exclude<MuteDuration, 'always'>, number> = {
  '1h': 60 * 60 * 1000,
  '8h': 8 * 60 * 60 * 1000,
  '1w': 7 * 24 * 60 * 60 * 1000,
}

// ¿Sigue silenciado ahora mismo? "muted" puede seguir en true después de
// que "muted_until" haya pasado (nada lo pone a false automáticamente, ni
// hace falta: esta función ya lo trata como "no silenciado" y la próxima
// vez que se toque esa fila desde la app se deja limpio).
export function isCurrentlyMuted(muted: boolean, mutedUntil: string | null): boolean {
  if (!muted) return false
  if (!mutedUntil) return true
  return new Date(mutedUntil).getTime() > Date.now()
}

// A partir de una duración elegida, calcula el valor a guardar en
// "muted_until" (null para "siempre").
export function muteUntilFor(duration: MuteDuration): string | null {
  if (duration === 'always') return null
  return new Date(Date.now() + DURATION_MS[duration]).toISOString()
}

export function formatMuteUntil(mutedUntil: string, language: 'es' | 'en'): string {
  const date = new Date(mutedUntil)
  return date.toLocaleString(language === 'en' ? 'en-US' : 'es-ES', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}
