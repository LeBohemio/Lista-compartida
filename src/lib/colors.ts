import type { TranslationKey } from './i18n'

// Paleta compartida: colores por persona (avatares/nombres) y por lista.
export const PALETTE = [
  '#6366f1', // indigo
  '#0ea5e9', // sky
  '#10b981', // emerald
  '#f59e0b', // amber
  '#ef4444', // red
  '#ec4899', // pink
  '#8b5cf6', // violet
  '#14b8a6', // teal
]

function hashString(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash)
  }
  return Math.abs(hash)
}

/** Color estable (siempre el mismo) a partir de un nombre o identificador. */
export function colorForName(name: string): string {
  return PALETTE[hashString(name || '?') % PALETTE.length]
}

// Nombre traducible de cada color de PALETTE, para que los botones de swatch
// tengan un aria-label legible por lector de pantalla ("Índigo" en vez de
// "Color #6366f1", que un lector de pantalla deletrearía carácter a
// carácter). Reutiliza las claves accent.* ya existentes para Ámbar/Rojo/
// Índigo/etc. (mismo set de colores que el selector de acento de Ajustes),
// y añade accent.violet/accent.teal para los dos que faltaban.
const PALETTE_NAME_KEYS: Record<string, TranslationKey> = {
  '#6366f1': 'accent.indigo',
  '#0ea5e9': 'accent.sky',
  '#10b981': 'accent.emerald',
  '#f59e0b': 'accent.amber',
  '#ef4444': 'accent.red',
  '#ec4899': 'accent.pink',
  '#8b5cf6': 'accent.violet',
  '#14b8a6': 'accent.teal',
}

/** Clave de traducción del nombre de un color de PALETTE (para aria-label). */
export function colorNameKey(hex: string): TranslationKey {
  return PALETTE_NAME_KEYS[hex] ?? 'menu.changeColor'
}

/** Color de una lista: el elegido al crearla, o uno estable según su nombre. */
export function colorForList(list: { id: string; name: string; color?: string | null }): string {
  return list.color || colorForName(list.name || list.id)
}

/** Color de una nota: el elegido a mano, o uno estable según su título. */
export function colorForNote(note: { id: string; title: string; color?: string | null }): string {
  return note.color || colorForName(note.title || note.id)
}
