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
// Diseño (v5): pegada de verdad al borde de abajo, a todo el ancho — como
// la cabecera de ListDetailPage, ya no flota separada del borde. Se
// deshizo el probado "insignia de cristal" de la v4 (cada icono en su
// propia mini-tarjeta): a la persona que usa la app no le gustaba que
// parecieran botones sueltos, así que se vuelve al icono desnudo de
// siempre — la pestaña activa se distingue con la píldora de degradado
// detrás de icono+texto (como ya hacía antes de la v4), no con una caja
// por icono.
export default function BottomNav({ pendingContactRequests = 0 }: { pendingContactRequests?: number }) {
  const { t } = useLanguage()

  return (
    <nav
      className="glass-panel fixed inset-x-0 bottom-0 z-40 flex items-center gap-1 rounded-t-[26px] px-2 pt-1.5 shadow-[0_-12px_32px_-18px_rgba(20,21,26,0.4)]"
      style={{ paddingBottom: 'calc(0.5rem + env(safe-area-inset-bottom))' }}
    >
      <div className="mx-auto flex w-full max-w-sm items-center gap-1">
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
                    className="absolute inset-0 rounded-full bg-gradient-to-br from-[var(--color-brand-500)] to-[var(--color-brand-600)] shadow-[0_8px_18px_-8px_var(--color-glow)]"
                    aria-hidden="true"
                  />
                )}
                <span className={`relative z-10 ${isActive ? 'text-white' : 'text-slate-500 dark:text-slate-400'}`}>
                  <tab.Icon className="h-5 w-5" />
                  {tab.to === '/contacts' && pendingContactRequests > 0 && (
                    <span className="absolute -right-2 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-semibold text-white ring-2 ring-[var(--color-surface)]">
                      {pendingContactRequests > 9 ? '9+' : pendingContactRequests}
                    </span>
                  )}
                </span>
                <span className={`relative z-10 ${isActive ? 'text-white' : 'text-slate-500 dark:text-slate-400'}`}>
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
