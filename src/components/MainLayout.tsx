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
    // BottomNav va DENTRO del mismo bloque que reconoce el deslizar (antes
    // estaba fuera, como hermano) — en todos los sitios donde deslizar ya
    // funcionaba bien (avatares, mensajes del chat…), lo que se toca justo
    // después de deslizar está dentro de esa misma zona, nunca fuera. Con
    // BottomNav como hermano, era la única zona de deslizar de toda la app
    // donde el siguiente toque caía en un elemento de fuera — y ahí es
    // justo donde el botón se quedaba sin reconocer el toque hasta
    // apretarlo una segunda vez. BottomNav sigue exactamente en el mismo
    // sitio visual (es "fixed", no depende de dónde esté en el DOM).
    //
    // select-none + touch-callout: mismo arreglo que ya llevan las filas
    // arrastrables de ListsPage.tsx/NotesPage.tsx — sin esto, el navegador
    // podía confundir el dedo deslizando de lado con "querer seleccionar
    // texto" y sacaba su selección nativa.
    <div className="touch-pan-y select-none [-webkit-touch-callout:none]" {...swipeNav}>
      <Outlet context={contactRequests} />
      <BottomNav pendingContactRequests={contactRequests.incoming.length} />
    </div>
  )
}
