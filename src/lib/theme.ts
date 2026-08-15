import type { Theme } from './types'

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '')
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean
  const num = Number.parseInt(full, 16)
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255]
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)))
  return '#' + [clamp(r), clamp(g), clamp(b)].map((n) => n.toString(16).padStart(2, '0')).join('')
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  let h = 0
  let s = 0
  const l = (max + min) / 2
  const d = max - min
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1))
    switch (max) {
      case r:
        h = ((g - b) / d) % 6
        break
      case g:
        h = (b - r) / d + 2
        break
      default:
        h = (r - g) / d + 4
    }
    h *= 60
    if (h < 0) h += 360
  }
  return [h, s * 100, l * 100]
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  s /= 100
  l /= 100
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  let [r, g, b] = [0, 0, 0]
  if (h < 60) [r, g, b] = [c, x, 0]
  else if (h < 120) [r, g, b] = [x, c, 0]
  else if (h < 180) [r, g, b] = [0, c, x]
  else if (h < 240) [r, g, b] = [0, x, c]
  else if (h < 300) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255]
}

function atLightness(hex: string, lightness: number, satBoostCap?: number): string {
  const [h, s] = rgbToHsl(...hexToRgb(hex))
  const finalSat = satBoostCap !== undefined ? Math.min(s, satBoostCap) : s
  return rgbToHex(...hslToRgb(h, finalSat, lightness))
}

/**
 * Genera la rampa de tonos brand-50/100/500/600/700 a partir de un único
 * color de acento. Los tonos 600/700 se calculan RELATIVOS a la luminosidad
 * del propio color elegido (en vez de a una luminosidad fija), para que
 * funcione igual de bien con acentos claros y con acentos ya oscuros — si no,
 * un acento oscuro podía acabar con un "600"/"700" más claro que el propio
 * "500", lo cual se ve raro en botones y hovers.
 */
export function shadesFromAccent(hex: string) {
  const [, , l] = rgbToHsl(...hexToRgb(hex))
  const l600 = Math.max(l - 20, 8)
  const l700 = Math.max(l - 32, 5)
  return {
    50: atLightness(hex, 95, 60),
    100: atLightness(hex, 90, 55),
    500: hex,
    600: atLightness(hex, l600),
    700: atLightness(hex, l700),
  }
}

/**
 * Genera los tonos de "superficie" (fondo de tarjetas/modales, fondo de
 * página, bordes sutiles) para el tema oscuro, a partir del color de acento
 * — en vez del gris genérico de siempre, para que todo el modo oscuro
 * combine con el acento elegido.
 */
export function surfaceShadesFromAccent(hex: string) {
  return {
    surface: atLightness(hex, 19, 26),
    surfaceAlt: atLightness(hex, 13, 24),
    surfaceBorder: atLightness(hex, 30, 30),
  }
}

const DEFAULT_ACCENT = '#4f46e5'

/** Aplica el tema (claro/oscuro/sistema) y el color de acento al documento entero. */
export function applyTheme(theme: Theme, accentColor: string | null) {
  const root = document.documentElement
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  const isDark = theme === 'dark' || (theme === 'system' && prefersDark)
  root.classList.toggle('dark', isDark)

  const effectiveAccent = accentColor || DEFAULT_ACCENT
  const shades = shadesFromAccent(effectiveAccent)
  root.style.setProperty('--color-brand-50', shades[50])
  root.style.setProperty('--color-brand-100', shades[100])
  root.style.setProperty('--color-brand-500', shades[500])
  root.style.setProperty('--color-brand-600', shades[600])
  root.style.setProperty('--color-brand-700', shades[700])

  const surf = surfaceShadesFromAccent(effectiveAccent)
  root.style.setProperty('--color-surface', surf.surface)
  root.style.setProperty('--color-surface-alt', surf.surfaceAlt)
  root.style.setProperty('--color-surface-border', surf.surfaceBorder)
}
