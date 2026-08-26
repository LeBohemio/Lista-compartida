import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import BottomNav from './BottomNav'
import { NAV_ROUTES } from '../lib/navRoutes'
import { useContactRequests } from '../hooks/useContactRequests'
import { useSwipeNav } from '../hooks/useSwipeNav'

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
  // orden — ver NAV_ROUTES en BottomNav.tsx), además de tocar la barra de
  // abajo. "touch-pan-y" dice al navegador desde el primer toque que el eje
  // vertical es scroll normal suyo y el horizontal lo decide este código —
  // así el scroll de cada pantalla no se ve afectado.
  const swipeNav = useSwipeNav({
    order: NAV_ROUTES,
    current: location.pathname,
    onChange: (path) => navigate(path),
  })

  return (
    <>
      <div className="touch-pan-y" {...swipeNav}>
        <Outlet context={contactRequests} />
      </div>
      <BottomNav pendingContactRequests={contactRequests.incoming.length} />
    </>
  )
}
