// Normaliza un número de teléfono para guardarlo y para buscarlo: quita
// espacios, guiones, puntos y paréntesis, y se queda solo con los dígitos
// (más un "+" delante si el número lo llevaba, para no perder el prefijo de
// país). Así "612 345 678", "612-345-678" y "+34 612 345 678" acaban
// guardados/comparados de la misma forma, sin más lógica que comparar el
// resultado de esto. Devuelve '' si no queda ningún dígito.
export function normalizePhone(raw: string): string {
  const trimmed = raw.trim()
  const hasPlus = trimmed.startsWith('+')
  const digits = trimmed.replace(/\D/g, '')
  if (!digits) return ''
  return hasPlus ? `+${digits}` : digits
}

// Para decidir, en el campo único de "email o teléfono" de los formularios
// de invitar/añadir contacto, cuál de los dos ha escrito la persona: si no
// lleva "@" y, quitando los caracteres típicos de un teléfono (espacios,
// guiones, puntos, paréntesis, un "+" al principio), lo que queda son solo
// dígitos, lo tratamos como teléfono. Cualquier otra cosa (incluido texto
// vacío, o con letras) se busca como email, igual que antes.
export function looksLikePhone(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed || trimmed.includes('@')) return false
  return /^\+?[\d\s().-]+$/.test(trimmed) && /\d/.test(trimmed)
}
