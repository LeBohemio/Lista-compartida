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

/** Color de una lista: el elegido al crearla, o uno estable según su nombre. */
export function colorForList(list: { id: string; name: string; color?: string | null }): string {
  return list.color || colorForName(list.name || list.id)
}

/** Color de una nota: el elegido a mano, o uno estable según su título. */
export function colorForNote(note: { id: string; title: string; color?: string | null }): string {
  return note.color || colorForName(note.title || note.id)
}
