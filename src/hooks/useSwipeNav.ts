import { useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { horizontalGestureClaim } from '../lib/gestureClaim'

// Cuánto tiene que moverse el dedo en horizontal para contar como "quiero
// cambiar de pantalla" — por debajo de esto es solo un toque con algo de
// temblor, o el principio de un scroll vertical.
const SWIPE_THRESHOLD_PX = 60

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
 * A propósito NO hay "onPointerMove" ni "preventDefault()" en ningún sitio
 * — se probó a añadirlo (para intentar bloquear a mano el scroll nativo
 * durante el gesto) y, en el móvil de verdad, dejaba el navegador en un
 * estado raro que solo se soltaba con un toque suelto después de cada
 * deslizar. AvatarPicker.tsx nunca ha tenido ese problema con su propio
 * carrusel de categorías, y es exactamente porque tampoco toca
 * preventDefault ni escucha pointermove — se apoya solo en "touch-action:
 * pan-y" y decide todo al soltar el dedo. Aquí se hace igual, a propósito.
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

  const onPointerDown = (e: ReactPointerEvent) => {
    if (horizontalGestureClaim.current) {
      startRef.current = null
      return
    }
    startRef.current = { x: e.clientX, y: e.clientY }
  }

  const onPointerUp = (e: ReactPointerEvent) => {
    const start = startRef.current
    startRef.current = null
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
  }

  return { onPointerDown, onPointerUp, onPointerCancel }
}
