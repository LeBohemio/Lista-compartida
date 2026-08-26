import { Outlet } from 'react-router-dom'
import BottomNav from './BottomNav'
import { useContactRequests } from '../hooks/useContactRequests'

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

  return (
    <>
      <Outlet context={contactRequests} />
      <BottomNav pendingContactRequests={contactRequests.incoming.length} />
    </>
  )
}
