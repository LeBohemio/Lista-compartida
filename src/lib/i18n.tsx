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
    'expenses.new': '+ Nuevo gasto',
    'invite.title': 'Invitar a la lista',
    'invite.submit': 'Invitar',
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
    'expenses.new': '+ New expense',
    'invite.title': 'Invite to the list',
    'invite.submit': 'Invite',
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
