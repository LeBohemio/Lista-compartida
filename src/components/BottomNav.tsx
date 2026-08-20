import { NavLink } from 'react-router-dom'
import { useLanguage, type TranslationKey } from '../lib/i18n'

// Iconos de línea (mismo estilo que un set tipo Lucide/Feather: trazo,
// sin relleno, extremos redondeados) — a mano, para no meter una
// dependencia nueva solo por 3 iconos.
function ListsIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <path d="M9 3.5h6a1 1 0 0 1 1 1V6H8V4.5a1 1 0 0 1 1-1Z" />
      <path d="m8.5 11 1.5 1.5L12.5 10" />
      <path d="M14.5 11h3" />
      <path d="m8.5 15.5 1.5 1.5 2.5-2.5" />
      <path d="M14.5 15.5h3" />
    </svg>
  )
}

// Nota común (ver migration_v23.sql): una hoja con líneas de texto, para
// distinguirla de un vistazo del icono de listas (que es una lista con
// checks).
function NotesIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M7 3.5h7l4 4V20a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z" />
      <path d="M14 3.5V7a1 1 0 0 0 1 1h3.5" />
      <path d="M8.5 12.5h7M8.5 15.5h7M8.5 18h4" />
    </svg>
  )
}

function ContactsIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <rect x="4" y="3.5" width="16" height="17" rx="2.2" />
      <path d="M4 7.5h2M4 11h2M4 14.5h2" />
      <circle cx="14" cy="10.5" r="2.3" />
      <path d="M10.3 17c.5-2 1.9-3 3.7-3s3.2 1 3.7 3" />
    </svg>
  )
}

function SettingsIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M4 6.5h9" />
      <circle cx="16" cy="6.5" r="2" />
      <path d="M4 12h4" />
      <circle cx="11" cy="12" r="2" />
      <path d="M13.5 12H20" />
      <path d="M4 17.5h9" />
      <circle cx="16" cy="17.5" r="2" />
    </svg>
  )
}

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
// Diseño (v2, sobre el mockup que mandaste): franja sólida con el color
// de acento en vez de la superficie neutra de antes, iconos de línea en
// blanco, una rayita vertical separando cada pestaña, y la pestaña activa
// marcada con una barrita blanca debajo — en vez de cambiar de color como
// antes. Uso brand-600→brand-700 (no brand-500, el acento "tal cual") a
// propósito: con blanco encima, brand-500 no da suficiente contraste para
// varios de los acentos claros de la app (amarillo, cian, verde...) —
// comprobado con la fórmula de contraste de WCAG en los 18 colores que
// ofrece el selector; con 600→700 los 18 pasan de sobra.
export default function BottomNav({ pendingContactRequests = 0 }: { pendingContactRequests?: number }) {
  const { t } = useLanguage()

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 flex bg-gradient-to-b from-brand-600 to-brand-700 shadow-[0_-2px_12px_rgba(0,0,0,0.15)]"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {TABS.map((tab, idx) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          className={({ isActive }) =>
            `relative flex flex-1 flex-col items-center gap-1 py-2.5 text-xs font-medium transition ${
              isActive ? 'text-white' : 'text-white/70 hover:text-white/90'
            } ${idx > 0 ? 'border-l border-white/15' : ''}`
          }
        >
          {({ isActive }) => (
            <>
              <span className="relative">
                <tab.Icon className="h-6 w-6" />
                {tab.to === '/contacts' && pendingContactRequests > 0 && (
                  <span className="absolute -right-2 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-semibold text-white ring-2 ring-brand-700">
                    {pendingContactRequests > 9 ? '9+' : pendingContactRequests}
                  </span>
                )}
              </span>
              <span>{t(tab.labelKey)}</span>
              <span
                className={`absolute bottom-0 h-1 rounded-t-full bg-white transition-all ${
                  isActive ? 'w-8 opacity-100' : 'w-8 opacity-0'
                }`}
                aria-hidden="true"
              />
            </>
          )}
        </NavLink>
      ))}
    </nav>
  )
}
