import type { TranslationKey } from './i18n'
import { ContactsIcon, ListsIcon, NotesIcon, SettingsIcon } from '../components/icons'

// Única fuente de verdad para las 4 pestañas principales — la usa
// BottomNav.tsx para pintar la barra de abajo. Vive en un archivo ".ts"
// aparte (no dentro de BottomNav.tsx) para no mezclar en un mismo archivo
// ".tsx" un componente con otras exportaciones — Fast Refresh (el
// recargado en caliente del navegador) se queja de eso.
export const NAV_TABS: { to: string; Icon: typeof ListsIcon; labelKey: TranslationKey }[] = [
  { to: '/lists', Icon: ListsIcon, labelKey: 'nav.tabLists' },
  { to: '/notes', Icon: NotesIcon, labelKey: 'nav.tabNotes' },
  { to: '/contacts', Icon: ContactsIcon, labelKey: 'nav.tabContacts' },
  { to: '/settings', Icon: SettingsIcon, labelKey: 'nav.tabSettings' },
]
