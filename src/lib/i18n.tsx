import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { supabase } from './supabaseClient'
import { useAuth } from '../context/AuthContext'
import type { Language } from './types'

// Diccionario de traducciones. De momento cubre las pantallas y textos más
// visibles de la app (navegación, botones principales, cabeceras). El resto
// de textos (mensajes de error, pantallas secundarias…) se irán añadiendo
// poco a poco en próximas pasadas — no es necesario traducir toda la app de
// golpe para que el selector de idioma ya sea útil.
const translations = {
  es: {
    'nav.notes': 'Notas',
    'nav.expenses': 'Gastos',
    'nav.chat': 'Chat',
    'common.add': 'Añadir',
    'common.cancel': 'Cancelar',
    'common.close': 'Cerrar',
    'common.save': 'Guardar',
    'common.done': 'Listo',
    'common.loading': 'Cargando…',
    'common.search': 'Buscar',
    'common.saving': 'Guardando…',
    'lists.title': 'Mis listas',
    'lists.create': 'Crear tu primera lista',
    'lists.empty': 'Todavía no tienes ninguna lista.',
    'lists.invitationsTitle': 'Invitaciones pendientes',
    'lists.accept': 'Aceptar',
    'lists.reject': 'Rechazar',
    'profile.title': 'Tu perfil',
    'profile.myExpenses': '📊 Mis gastos',
    'profile.signOut': 'Cerrar sesión',
    'profile.deleteAccount': 'Eliminar cuenta',
    'profile.appearance': 'Apariencia',
    'profile.language': 'Idioma',
    'profile.changePhoto': 'Cambiar foto',
    'profile.uploading': 'Subiendo…',
    'profile.accentColor': 'Color de acento',
    'profile.backgroundColor': 'Color de fondo',
    'profile.changeUsername': 'Cambiar nombre de usuario',
    'profile.updateUsername': 'Actualizar nombre de usuario',
    'profile.changePassword': 'Cambiar contraseña',
    'profile.newPassword': 'Contraseña nueva',
    'profile.repeatPassword': 'Repite la contraseña',
    'profile.updatePassword': 'Actualizar contraseña',
    'profile.changeEmail': 'Cambiar email',
    'profile.updateEmail': 'Actualizar email',
    'expenses.new': '+ Nuevo gasto',
    'expenses.historic': 'Histórico',
    'expenses.byCategory': 'Por categoría',
    'expenses.searchPlaceholder': 'Buscar en el histórico…',
    'expenses.emptySearch': 'No hay resultados para esa búsqueda.',
    'expenses.empty': 'Aún no hay gastos por aquí. ¡Anota el primero!',
    'expenses.addFirst': '➕ Añadir tu primer gasto',
    'myExpenses.title': 'Mis gastos',
    'myExpenses.total': 'Total',
    'myExpenses.collected': 'Cobrado',
    'myExpenses.empty': 'No pagaste ningún gasto compartido este mes.',
    'notes.searchPlaceholder': 'Buscar en esta lista…',
    'notes.emptySearch': 'No hay notas que coincidan con la búsqueda.',
    'notes.empty': 'Todavía no hay notas en esta lista.',
    'notes.addFirst': '➕ Añadir tu primera nota',
    'notes.markAllDone': '✓ Marcar todas como hechas',
    'notes.emptyDone': '🗑 Vaciar comprados',
    'notes.addTitle': 'Añadir nota',
    'notes.addPlaceholder': 'Añadir nota…',
    'invite.title': 'Invitar a la lista',
    'invite.submit': 'Invitar',
    'menu.open': 'Abrir',
    'menu.pin': 'Fijar lista',
    'menu.unpin': 'Quitar de fijadas',
    'menu.duplicate': 'Duplicar',
    'menu.editNote': 'Editar',
    'menu.dueDate': 'Fecha límite',
    'menu.delete': 'Eliminar',
    'menu.copy': 'Copiar',
    'menu.forward': 'Reenviar',
    'menu.cancel': 'Cancelar',
    'lists.owner': 'Creador',
    'lists.member': 'Miembro',
    'lists.expensesOn': 'Gastos activados',
    'lists.archived': 'Archivada',
    'lists.deleteList': 'Eliminar lista',
    'lists.leaveList': 'Salir de la lista',
    'lists.dragHandle': 'Arrastrar para reordenar',
    'menu.reorder': 'Reordenar',
    'reorder.byDate': 'Por fecha',
    'reorder.alpha': 'Alfabético',
    'reorder.custom': 'Orden personalizado',
    'reorder.bannerHint': 'Arrastra ⠿ para reordenar',
    'reorder.done': 'Listo',
    'notes.addedBy': 'Añadido por',
    'notes.due': 'Vence',
  },
  en: {
    'nav.notes': 'Notes',
    'nav.expenses': 'Expenses',
    'nav.chat': 'Chat',
    'common.add': 'Add',
    'common.cancel': 'Cancel',
    'common.close': 'Close',
    'common.save': 'Save',
    'common.done': 'Done',
    'common.loading': 'Loading…',
    'common.search': 'Search',
    'common.saving': 'Saving…',
    'lists.title': 'My lists',
    'lists.create': 'Create your first list',
    'lists.empty': "You don't have any lists yet.",
    'lists.invitationsTitle': 'Pending invitations',
    'lists.accept': 'Accept',
    'lists.reject': 'Decline',
    'profile.title': 'Your profile',
    'profile.myExpenses': '📊 My expenses',
    'profile.signOut': 'Sign out',
    'profile.deleteAccount': 'Delete account',
    'profile.appearance': 'Appearance',
    'profile.language': 'Language',
    'profile.changePhoto': 'Change photo',
    'profile.uploading': 'Uploading…',
    'profile.accentColor': 'Accent color',
    'profile.backgroundColor': 'Background color',
    'profile.changeUsername': 'Change username',
    'profile.updateUsername': 'Update username',
    'profile.changePassword': 'Change password',
    'profile.newPassword': 'New password',
    'profile.repeatPassword': 'Repeat password',
    'profile.updatePassword': 'Update password',
    'profile.changeEmail': 'Change email',
    'profile.updateEmail': 'Update email',
    'expenses.new': '+ New expense',
    'expenses.historic': 'History',
    'expenses.byCategory': 'By category',
    'expenses.searchPlaceholder': 'Search history…',
    'expenses.emptySearch': 'No results for that search.',
    'expenses.empty': "There aren't any expenses here yet. Add the first one!",
    'expenses.addFirst': '➕ Add your first expense',
    'myExpenses.title': 'My expenses',
    'myExpenses.total': 'Total',
    'myExpenses.collected': 'Collected',
    'myExpenses.empty': "You didn't pay for any shared expense this month.",
    'notes.searchPlaceholder': 'Search this list…',
    'notes.emptySearch': 'No notes match your search.',
    'notes.empty': "There aren't any notes in this list yet.",
    'notes.addFirst': '➕ Add your first note',
    'notes.markAllDone': '✓ Mark all as done',
    'notes.emptyDone': '🗑 Clear done',
    'notes.addTitle': 'Add note',
    'notes.addPlaceholder': 'Add note…',
    'invite.title': 'Invite to the list',
    'invite.submit': 'Invite',
    'menu.open': 'Open',
    'menu.pin': 'Pin list',
    'menu.unpin': 'Unpin',
    'menu.duplicate': 'Duplicate',
    'menu.editNote': 'Edit',
    'menu.dueDate': 'Due date',
    'menu.delete': 'Delete',
    'menu.copy': 'Copy',
    'menu.forward': 'Forward',
    'menu.cancel': 'Cancel',
    'lists.owner': 'Owner',
    'lists.member': 'Member',
    'lists.expensesOn': 'Expenses on',
    'lists.archived': 'Archived',
    'lists.deleteList': 'Delete list',
    'lists.leaveList': 'Leave list',
    'lists.dragHandle': 'Drag to reorder',
    'menu.reorder': 'Reorder',
    'reorder.byDate': 'By date',
    'reorder.alpha': 'Alphabetical',
    'reorder.custom': 'Custom order',
    'reorder.bannerHint': 'Drag ⠿ to reorder',
    'reorder.done': 'Done',
    'notes.addedBy': 'Added by',
    'notes.due': 'Due',
  },
} as const

export type TranslationKey = keyof (typeof translations)['es']

type LanguageContextValue = {
  language: Language
  setLanguage: (lang: Language) => void
  t: (key: TranslationKey) => string
}

const LanguageContext = createContext<LanguageContextValue | null>(null)

const LOCAL_STORAGE_KEY = 'listas-en-comun-language'

export function LanguageProvider({ children }: { children: ReactNode }) {
  const { user, profile, refreshProfile } = useAuth()
  const [language, setLanguageState] = useState<Language>(() => {
    if (typeof window === 'undefined') return 'es'
    const stored = window.localStorage.getItem(LOCAL_STORAGE_KEY)
    return stored === 'en' || stored === 'es' ? stored : 'es'
  })

  useEffect(() => {
    if (profile?.language) setLanguageState(profile.language)
  }, [profile?.language])

  const setLanguage = useCallback(
    (lang: Language) => {
      setLanguageState(lang)
      window.localStorage.setItem(LOCAL_STORAGE_KEY, lang)
      if (user) {
        supabase
          .from('profiles')
          .update({ language: lang })
          .eq('id', user.id)
          .then(() => refreshProfile())
      }
    },
    [user, refreshProfile],
  )

  const t = useCallback((key: TranslationKey) => translations[language][key] ?? translations.es[key] ?? key, [language])

  const value = useMemo(() => ({ language, setLanguage, t }), [language, setLanguage, t])

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}

export function useLanguage() {
  const ctx = useContext(LanguageContext)
  if (!ctx) throw new Error('useLanguage debe usarse dentro de <LanguageProvider>')
  return ctx
}
