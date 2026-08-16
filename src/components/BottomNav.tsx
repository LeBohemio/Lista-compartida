import { NavLink } from 'react-router-dom'
import { useLanguage, type TranslationKey } from '../lib/i18n'

const TABS: { to: string; icon: string; labelKey: TranslationKey }[] = [
  { to: '/lists', icon: '📋', labelKey: 'nav.tabLists' },
  { to: '/contacts', icon: '👥', labelKey: 'nav.tabContacts' },
  { to: '/settings', icon: '⚙️', labelKey: 'nav.tabSettings' },
]

// Barra de navegación fija, persistente en toda la app (Mis listas /
// Contactos / Ajustes) — ver MainLayout.tsx. Solo se muestra envolviendo
// esas 3 pantallas; el detalle de una lista y las pantallas de
// login/registro se quedan fuera, a pantalla completa.
export default function BottomNav({ pendingContactRequests = 0 }: { pendingContactRequests?: number }) {
  const { t } = useLanguage()

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 flex border-t bg-[var(--color-surface)] border-[var(--color-surface-border)]"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {TABS.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          className={({ isActive }) =>
            `flex flex-1 flex-col items-center gap-0.5 py-2 text-xs font-medium transition ${
              isActive ? 'text-brand-600 dark:text-brand-400' : 'text-slate-400 dark:text-slate-500'
            }`
          }
        >
          <span className="relative text-xl leading-none" aria-hidden="true">
            {tab.icon}
            {tab.to === '/contacts' && pendingContactRequests > 0 && (
              <span className="absolute -right-2.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-semibold text-white ring-2 ring-[var(--color-surface)]">
                {pendingContactRequests > 9 ? '9+' : pendingContactRequests}
              </span>
            )}
          </span>
          {t(tab.labelKey)}
        </NavLink>
      ))}
    </nav>
  )
}
