import { useLanguage } from '../lib/i18n'
import { useOnlineStatus } from '../hooks/useOnlineStatus'

// Franja fija arriba del todo, por encima incluso de la cabecera de cada
// pestaña (z-50, mismo nivel que los modales) — visible se esté donde se
// esté en la app, con o sin sesión iniciada. Antes, si el móvil se quedaba
// sin conexión, los guardados fallaban en silencio y quien usa la app no
// tenía forma de saber por qué "no se estaba guardando nada".
export default function OfflineBanner() {
  const online = useOnlineStatus()
  const { t } = useLanguage()

  if (online) return null

  return (
    <div
      role="status"
      className="fixed inset-x-0 top-0 z-50 bg-amber-500 px-4 py-2 text-center text-xs font-medium text-white shadow-md"
      style={{ paddingTop: 'calc(0.5rem + env(safe-area-inset-top))' }}
    >
      {t('common.offline')}
    </div>
  )
}
