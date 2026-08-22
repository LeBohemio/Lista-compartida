import { NavLink } from 'react-router-dom'
import { useLanguage, type TranslationKey } from '../lib/i18n'
import { ContactsIcon, ListsIcon, NotesIcon, SettingsIcon } from './icons'

const TABS: { to: string; Icon: typeof ListsIcon; labelKey: TranslationKey }[] = [
  { to: '/lists', Icon: ListsIcon, labelKey: 'nav.tabLists' },
  { to: '/notes', Icon: NotesIcon, labelKey: 'nav.tabNotes' },
  { to: '/contacts', Icon: ContactsIcon, labelKey: 'nav.tabContacts' },
  { to: '/settings', Icon: SettingsIcon, labelKey: 'nav.tabSettings' },
]

// Barra de navegación fija, persistente en toda la app (Mis listas /
// Contactos / Ajustes) — ver MainLayout.tsx. Solo se muestra envolviendo
// esas 3 pantallas; el detalle de una lista y las pantallas de
// login/registro se quedan fuera, a pantalla completa.
//
// Diseño (v6): mismo tratamiento "formas suaves flotantes" que las
// cabeceras (ver HEADER_ACCENT_FLOAT en SettingsPage.tsx) — fondo liso
// oscuro del acento con un par de manchas difuminadas del mismo acento en
// tonos más claros, en vez del panel de cristal neutro de antes. Pegada de
// verdad al borde de abajo, a todo el ancho, en rectángulo completo (sin
// ninguna esquina redondeada — antes llevaba las de arriba redondeadas).
export default function BottomNav({ pendingContactRequests = 0 }: { pendingContactRequests?: number }) {
  const { t } = useLanguage()

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 overflow-hidden bg-[var(--color-brand-700)] px-2 pt-1.5 shadow-[0_-12px_32px_-18px_rgba(20,21,26,0.4)]"
      style={{ paddingBottom: 'calc(0.5rem + env(safe-area-inset-bottom))' }}
    >
      <span className="pointer-events-none absolute -right-8 -top-10 h-28 w-28 rounded-full bg-[var(--color-brand-400)] opacity-50 blur-2xl" />
      <span className="pointer-events-none absolute -bottom-12 left-10 h-24 w-24 rounded-full bg-[var(--color-brand-300)] opacity-30 blur-xl" />
      <div className="relative mx-auto flex w-full max-w-sm items-center gap-1">
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            className="relative flex flex-1 flex-col items-center gap-0.5 rounded-full py-2 text-[11px] font-medium transition"
          >
            {({ isActive }) => (
              <>
                {isActive && (
                  <span
                    className="absolute inset-0 rounded-full bg-white shadow-[0_8px_18px_-8px_rgba(20,21,26,0.4)]"
                    aria-hidden="true"
                  />
                )}
                <span className={`relative z-10 ${isActive ? 'text-[var(--color-brand-700)]' : 'text-white/75'}`}>
                  <tab.Icon className="h-5 w-5" />
                  {tab.to === '/contacts' && pendingContactRequests > 0 && (
                    <span className="absolute -right-2 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-semibold text-white ring-2 ring-[var(--color-brand-700)]">
                      {pendingContactRequests > 9 ? '9+' : pendingContactRequests}
                    </span>
                  )}
                </span>
                <span className={`relative z-10 ${isActive ? 'text-[var(--color-brand-700)]' : 'text-white/75'}`}>
                  {t(tab.labelKey)}
                </span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
