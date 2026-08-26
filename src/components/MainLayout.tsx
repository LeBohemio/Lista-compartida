import { useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import BottomNav from './BottomNav'
import { NAV_ROUTES } from '../lib/navRoutes'
import { useContactRequests } from '../hooks/useContactRequests'
import { horizontalGestureClaim } from '../lib/gestureClaim'

// Cuánto tiene que moverse el dedo en horizontal para contar como "quiero
// cambiar de pantalla" — igual que el umbral del carrusel de categorías de
// AvatarPicker.tsx.
const SWIPE_THRESHOLD_PX = 60

// Layout compartido por las 4 pantallas principales de la app (Mis listas,
// Notas, Contactos, Ajustes): pinta la pantalla que toque vía <Outlet /> y
// encima la barra de navegación inferior, siempre visible. Se monta una
// única vez (React Router no la vuelve a montar al cambiar de pestaña), así
// que la suscripción realtime de useContactRequests no se reinicia en cada
// cambio de pestaña.
//
// Las páginas hijas reciben estos mismos datos (contactos, peticiones
// pendientes…) vía useOutletContext(), en vez de tener cada una su propia
// copia — así solo hay una fuente de verdad y una única suscripción
// realtime para todo esto.
export default function MainLayout() {
  const contactRequests = useContactRequests()
  const location = useLocation()
  const navigate = useNavigate()

  // Deslizar hacia los lados sobre el contenido de la pantalla también
  // cambia de pestaña (Mis listas ⇄ Notas ⇄ Contactos ⇄ Ajustes, en ese
  // orden — ver NAV_ROUTES). El gesto va escrito aquí mismo, sin pasar por
  // ningún hook compartido — calcado a propósito del carrusel de
  // categorías de AvatarPicker.tsx, que es el único otro sitio de la app
  // donde deslizar cambia de "pantalla" en vez de hacer scroll. La decisión
  // se toma entera al soltar el dedo (comparando dónde bajó y dónde subió),
  // sin capturar el puntero ni arrastre visual de por medio, así convive
  // sin problema con el scroll vertical normal ("touch-pan-y" abajo).
  const swipeStartRef = useRef<{ x: number; y: number } | null>(null)

  const handlePointerDown = (e: ReactPointerEvent) => {
    if (horizontalGestureClaim.current) {
      swipeStartRef.current = null
      return
    }
    swipeStartRef.current = { x: e.clientX, y: e.clientY }
  }

  const handlePointerUp = (e: ReactPointerEvent) => {
    const start = swipeStartRef.current
    swipeStartRef.current = null
    if (!start) return
    // Se comprueba otra vez aquí, no solo al bajar el dedo: un gesto más
    // específico de más adentro (responder a un mensaje, adelantar un
    // audio, cambiar de categoría de avatar…) puede haberse activado a
    // mitad de camino.
    if (horizontalGestureClaim.current) return
    const deltaX = e.clientX - start.x
    const deltaY = e.clientY - start.y
    if (Math.abs(deltaX) < SWIPE_THRESHOLD_PX || Math.abs(deltaX) < Math.abs(deltaY)) return
    const index = NAV_ROUTES.indexOf(location.pathname)
    if (index === -1) return
    const nextIndex = deltaX < 0 ? index + 1 : index - 1
    if (nextIndex < 0 || nextIndex >= NAV_ROUTES.length) return
    navigate(NAV_ROUTES[nextIndex])
  }

  const handlePointerCancel = () => {
    swipeStartRef.current = null
  }

  return (
    // BottomNav va DENTRO del mismo bloque que reconoce el deslizar (no
    // como hermano) — en el carrusel de avatares, lo que se toca justo
    // después de deslizar está siempre dentro de la misma zona deslizada;
    // aquí se hace igual, a propósito. BottomNav sigue en el mismo sitio
    // visual de siempre (es "fixed", no depende de dónde esté en el DOM).
    <div
      className="touch-pan-y select-none [-webkit-touch-callout:none]"
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
    >
      <Outlet context={contactRequests} />
      <BottomNav pendingContactRequests={contactRequests.incoming.length} />
    </div>
  )
}
