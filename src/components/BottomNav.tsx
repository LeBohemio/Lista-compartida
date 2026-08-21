import { NavLink } from 'react-router-dom'
import { useLanguage, type TranslationKey } from '../lib/i18n'
import { ContactsIcon, IconChip, ListsIcon, NotesIcon, SettingsIcon } from './icons'

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
// Diseño (v4, "Insignia de cristal" — propuesta B del estudio de iconos):
// cada pestaña es ahora la misma mini-tarjeta de cristal (IconChip, ver
// icons.tsx) que se usa en el resto de la app para los demás dibujos, así
// la barra queda alineada al mismo sistema. La pestaña activa cambia su
// cristal neutro por el degradado de acento + halo (la misma pista visual
// de "seleccionado" que ya usan el botón "Crear lista" o el mensaje propio
// del chat); el nombre de la pestaña vive fuera de la tarjeta, debajo.
export default function BottomNav({ pendingContactRequests = 0 }: { pendingContactRequests?: number }) {
  const { t } = useLanguage()

  return (
    <nav
      className="glass-panel fixed inset-x-4 z-40 mx-auto flex max-w-sm items-center justify-between gap-1 rounded-[28px] p-2 shadow-[0_20px_44px_-22px_rgba(20,21,26,0.45)]"
      style={{ bottom: 'calc(0.9rem + env(safe-area-inset-bottom))' }}
    >
      {TABS.map((tab) => (
        <NavLink key={tab.to} to={tab.to} className="flex flex-1 flex-col items-center gap-1 py-0.5">
          {({ isActive }) => (
            <>
              <span className="relative">
                <IconChip active={isActive} size={42}>
                  <tab.Icon className="h-5 w-5" />
                </IconChip>
                {tab.to === '/contacts' && pendingContactRequests > 0 && (
                  <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-semibold text-white ring-2 ring-[var(--color-surface)]">
                    {pendingContactRequests > 9 ? '9+' : pendingContactRequests}
                  </span>
                )}
              </span>
              <span
                className={`text-[11px] font-medium transition ${
                  isActive ? 'text-[var(--color-brand-600)] dark:text-[var(--color-brand-300)]' : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                {t(tab.labelKey)}
              </span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  )
}
