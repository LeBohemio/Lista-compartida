import { useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { horizontalGestureClaim } from '../lib/gestureClaim'

// Cuánto tiene que moverse el dedo en horizontal para contar como "quiero
// cambiar de pantalla" — por debajo de esto es solo un toque con algo de
// temblor, o el principio de un scroll vertical.
const SWIPE_THRESHOLD_PX = 60

// A partir de cuántos píxeles de movimiento nos "decidimos" sobre si el
// gesto va a ser horizontal o vertical. Tiene que ser pequeño para
// decidirlo pronto (antes de que el navegador arranque su propio scroll),
// pero no tan pequeño como para confundir el temblor normal de un toque con
// el principio de un deslizar.
const DIRECTION_LOCK_PX = 10

/**
 * Deslizar hacia los lados para moverse entre un conjunto ordenado de
 * "paradas" (rutas del menú principal, o las pestañas de dentro de una
 * lista) — deslizar a la izquierda avanza a la siguiente, a la derecha
 * retrocede a la anterior. En los extremos (primera/última parada) no pasa
 * nada, no da la vuelta.
 *
 * La decisión de si un gesto cuenta como swipe se toma entera al soltar el
 * dedo (comparando el punto de bajada y el de subida), igual que ya hace
 * AvatarPicker.tsx con su propio carrusel de categorías — no se seduce
 * ningún arrastre visual de por medio ni se captura el puntero, así que
 * este gesto convive sin problema con el scroll vertical normal de la
 * pantalla (para eso hace falta poner la clase "touch-pan-y" en el elemento
 * donde se enganchen estos manejadores — sin eso, el navegador podría
 * decidir por su cuenta qué hacer con el arrastre horizontal antes de que
 * este código llegue a verlo).
 *
 * Antes de aceptar el gesto se comprueba "horizontalGestureClaim" (ver
 * gestureClaim.ts): si algún gesto más específico de más adentro ya está
 * usando el eje horizontal (responder a un mensaje, adelantar un audio,
 * cambiar de categoría de avatar…), este swipe de navegación se queda
 * quieto y no hace nada con ese gesto.
 *
 * "onPointerMove" vigila hacia qué lado se va decantando el gesto apenas
 * empieza (a los pocos píxeles): si es claramente horizontal, llama a
 * preventDefault() en cada movimiento siguiente para que el navegador NO
 * arranque también su scroll vertical nativo "de refilón". Sin esto, un
 * deslizar con algo de diagonal (lo normal con un dedo real) podía hacer
 * que la pantalla siguiera moviéndose con inercia un instante después de
 * soltar — y entonces el siguiente toque (por ejemplo, en un botón de la
 * barra de abajo) solo servía para frenar esa inercia, no para pulsar el
 * botón, y hacía falta tocar dos veces.
 */
export function useSwipeNav<T extends string>({
  order,
  current,
  onChange,
}: {
  order: readonly T[]
  current: T
  onChange: (next: T) => void
}) {
  const startRef = useRef<{ x: number; y: number } | null>(null)
  // null = todavía sin decidir, 'horizontal' = deslizar de lado (bloqueamos
  // el scroll nativo), 'vertical' = es scroll normal, no tocamos nada más.
  const lockRef = useRef<'horizontal' | 'vertical' | null>(null)

  const onPointerDown = (e: ReactPointerEvent) => {
    if (horizontalGestureClaim.current) {
      startRef.current = null
      return
    }
    startRef.current = { x: e.clientX, y: e.clientY }
    lockRef.current = null
  }

  const onPointerMove = (e: ReactPointerEvent) => {
    const start = startRef.current
    if (!start || lockRef.current === 'vertical' || horizontalGestureClaim.current) return
    if (lockRef.current === 'horizontal') {
      // Ya decidido: seguimos bloqueando el scroll nativo el resto del gesto.
      e.preventDefault()
      return
    }
    const deltaX = e.clientX - start.x
    const deltaY = e.clientY - start.y
    if (Math.abs(deltaX) < DIRECTION_LOCK_PX && Math.abs(deltaY) < DIRECTION_LOCK_PX) return
    if (Math.abs(deltaX) > Math.abs(deltaY)) {
      lockRef.current = 'horizontal'
      e.preventDefault()
    } else {
      // Es scroll vertical de verdad: lo dejamos ir, tal cual, con inercia
      // incluida — es justo lo que se espera de un scroll normal.
      lockRef.current = 'vertical'
    }
  }

  const onPointerUp = (e: ReactPointerEvent) => {
    const start = startRef.current
    startRef.current = null
    lockRef.current = null
    if (!start) return
    // Se comprueba otra vez aquí, no solo al bajar el dedo: un gesto más
    // específico de más adentro puede haberse activado a mitad de camino.
    if (horizontalGestureClaim.current) return
    const deltaX = e.clientX - start.x
    const deltaY = e.clientY - start.y
    // Solo cuenta si el movimiento es claramente más horizontal que
    // vertical — si no, era scroll normal de la pantalla.
    if (Math.abs(deltaX) < SWIPE_THRESHOLD_PX || Math.abs(deltaX) < Math.abs(deltaY)) return
    const index = order.indexOf(current)
    if (index === -1) return
    const nextIndex = deltaX < 0 ? index + 1 : index - 1
    if (nextIndex < 0 || nextIndex >= order.length) return
    onChange(order[nextIndex])
  }

  const onPointerCancel = () => {
    startRef.current = null
    lockRef.current = null
  }

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel }
}
