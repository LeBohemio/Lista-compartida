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

/** true si el color es lo bastante claro como para considerarse un fondo "claro". */
function isLightColor(hex: string): boolean {
  const [, , l] = rgbToHsl(...hexToRgb(hex))
  return l >= 50
}

function hexToRgbaString(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/**
 * Genera los tonos de "superficie" (fondo de tarjetas/modales, bordes
 * sutiles, líneas finas como las de una hoja pautada) a partir del color de
 * acento — en vez del gris (o el ámbar fijo del bloc de notas) de siempre,
 * para que todo combine con el acento elegido. Genera una rampa distinta
 * según el fondo que realmente se vea sea claro u oscuro: pastel clarito
 * sobre fondo claro, mate oscuro sobre fondo oscuro.
 */
export function surfaceShadesFromAccent(hex: string, isDark: boolean) {
  if (isDark) {
    const border = atLightness(hex, 30, 30)
    return {
      surface: atLightness(hex, 19, 26),
      surfaceAlt: atLightness(hex, 13, 24),
      surfaceBorder: border,
      surfaceLine: hexToRgbaString(border, 0.4),
    }
  }
  const border = atLightness(hex, 82, 35)
  return {
    surface: atLightness(hex, 99, 22),
    surfaceAlt: atLightness(hex, 96, 24),
    surfaceBorder: border,
    surfaceLine: hexToRgbaString(border, 0.55),
  }
}

const DEFAULT_ACCENT = '#4f46e5'

/**
 * Aplica el tema, el color de acento y el fondo al documento entero.
 *
 * La clase `dark` (de la que dependen todos los estilos `dark:*`) ya no la
 * decide solo la preferencia de tema — la decide el fondo que realmente se
 * ve: si hay un `backgroundColor` personalizado, manda su propia luminosidad;
 * si no hay ninguno elegido, se usa el fondo por defecto del tema. Así, si
 * alguien tiene el tema oscuro pero elige un fondo clarito (o al revés), la
 * interfaz entera (tarjetas, texto, bordes) se ve acorde a lo que realmente
 * tiene delante, no a un ajuste que ya no representa lo que ve.
 */
export function applyTheme(theme: Theme, accentColor: string | null, backgroundColor: string | null) {
  const root = document.documentElement
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  const themeIsDark = theme === 'dark' || (theme === 'system' && prefersDark)
  const isDark = backgroundColor ? !isLightColor(backgroundColor) : themeIsDark
  root.classList.toggle('dark', isDark)

  const effectiveAccent = accentColor || DEFAULT_ACCENT
  const shades = shadesFromAccent(effectiveAccent)
  root.style.setProperty('--color-brand-50', shades[50])
  root.style.setProperty('--color-brand-100', shades[100])
  root.style.setProperty('--color-brand-500', shades[500])
  root.style.setProperty('--color-brand-600', shades[600])
  root.style.setProperty('--color-brand-700', shades[700])

  const surf = surfaceShadesFromAccent(effectiveAccent, isDark)
  root.style.setProperty('--color-surface', surf.surface)
  root.style.setProperty('--color-surface-alt', surf.surfaceAlt)
  root.style.setProperty('--color-surface-border', surf.surfaceBorder)
  root.style.setProperty('--color-surface-line', surf.surfaceLine)
}
