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
    'reorder.bannerHint': 'Mantén pulsado y arrastra para reordenar',
    'reorder.done': 'Listo',
    'notes.addedBy': 'Añadido por',
    'notes.due': 'Vence',
    'notes.doneSectionLabel': 'Hechos / comprados',
    'lists.completedBadge': 'Completada',
    'lists.completedSection': 'Listas completadas',
    'menu.complete': 'Completar lista',
    'menu.reactivate': 'Reactivar lista',
    'dialogs.completeTitle': '¿Completar lista?',
    'dialogs.completeMessage':
      'Dejará de aparecer en tus listas activas y pasará a "Listas completadas". Podrás seguir consultando sus notas, gastos y chat en cualquier momento, pero no podrás añadir cosas nuevas mientras esté completada. Si más adelante la necesitas, puedes reactivarla cuando quieras y todo volverá a estar disponible.',
    'dialogs.completeConfirm': 'Completar',
    'dialogs.deleteMessage':
      '¿Eliminar definitivamente la lista "{name}"? Se borrará para todos los miembros, junto con sus notas, gastos y chat. Los gastos que se pagaron aquí dejarán de aparecer en tu histórico. Esta acción no se puede deshacer. Si solo quieres dejar de verla pero conservarlo todo, prueba mejor a completarla en vez de eliminarla.',
    'lists.readOnlyBanner': 'Esta lista está completada. Puedes consultar notas, gastos y chat, pero no añadir cosas nuevas.',
    'notes.readOnlyHint': 'Lista completada: solo consulta. Reactívala para poder añadir notas.',
    'expenses.readOnlyHint': 'Lista completada: solo consulta. Reactívala para poder añadir gastos.',
    'chat.readOnlyHint': 'Lista completada: solo puedes consultar el chat. Reactívala para escribir de nuevo.',
    'home.morning': 'Buenos días',
    'home.afternoon': 'Buenas tardes',
    'home.evening': 'Buenas noches',
    'home.activeLists': 'listas activas',
    'home.pendingNotes': 'pendientes',
    'home.allDone': 'Todo al día 👍',
    'auth.email': 'Email',
    'auth.password': 'Contraseña',
    'auth.forgotPassword': '¿Olvidaste tu contraseña?',
    'auth.enter': 'Entrar',
    'auth.entering': 'Entrando…',
    'auth.noAccount': '¿No tienes cuenta?',
    'auth.register': 'Regístrate',
    'auth.haveAccount': '¿Ya tienes cuenta?',
    'auth.signIn': 'Entra',
    'auth.appTagline': 'Entra para ver tus listas',
    'auth.username': 'Nombre de usuario',
    'auth.usernamePlaceholder': 'Cómo te verán los demás',
    'auth.createAccount': 'Crear cuenta',
    'auth.creatingAccount': 'Creando cuenta…',
    'auth.registerTagline': 'Únete para crear y compartir listas',
    'auth.accountCreated': '¡Cuenta creada!',
    'auth.accountCreatedBody':
      'Si tu proyecto de Supabase pide confirmación por email, revisa tu bandeja de entrada antes de entrar. Si no, ya puedes iniciar sesión directamente.',
    'auth.goToLogin': 'Ir a iniciar sesión',
    'auth.recoverPassword': 'Recuperar contraseña',
    'auth.recoverPasswordBody': 'Te mandaremos un enlace a tu email para elegir una contraseña nueva.',
    'auth.recoverPasswordSent':
      'Si ese email tiene una cuenta, te hemos mandado un enlace para elegir una contraseña nueva. Revisa tu bandeja de entrada (y spam).',
    'auth.sendLink': 'Enviar enlace',
    'auth.sending': 'Enviando…',
    'auth.understood': 'Entendido',
    'theme.light': '☀️ Claro',
    'theme.dark': '🌙 Oscuro',
    'theme.system': '📱 Del móvil',
    'bg.default': 'Por defecto',
    'bg.warm': 'Cálido',
    'bg.blue': 'Azulado',
    'bg.green': 'Verdoso',
    'bg.pink': 'Rosado',
    'bg.purple': 'Lila',
    'bg.yellow': 'Amarillo suave',
    'bg.darkVariants': 'Tonos oscuros',
    'profile.usernameUpdated': 'Nombre de usuario actualizado.',
    'profile.passwordsDontMatch': 'Las dos contraseñas no coinciden.',
    'profile.passwordTooShort': 'La contraseña debe tener al menos 6 caracteres.',
    'profile.passwordUpdated': 'Contraseña actualizada.',
    'profile.emailConfirmSent':
      'Te hemos mandado un email de confirmación a la nueva dirección. Hasta que no lo confirmes, seguirás entrando con la actual.',
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
    'reorder.bannerHint': 'Press and hold, then drag to reorder',
    'reorder.done': 'Done',
    'notes.addedBy': 'Added by',
    'notes.due': 'Due',
    'notes.doneSectionLabel': 'Done / bought',
    'lists.completedBadge': 'Completed',
    'lists.completedSection': 'Completed lists',
    'menu.complete': 'Complete list',
    'menu.reactivate': 'Reactivate list',
    'dialogs.completeTitle': 'Complete this list?',
    'dialogs.completeMessage':
      'It will stop showing up in your active lists and move to "Completed lists". You can keep checking its notes, expenses and chat any time, but you won\'t be able to add new things while it\'s completed. If you need it later, you can reactivate it whenever you want and everything will be available again.',
    'dialogs.completeConfirm': 'Complete',
    'dialogs.deleteMessage':
      'Permanently delete the list "{name}"? It will be deleted for all members, along with its notes, expenses and chat. Expenses paid here will disappear from your history. This action can\'t be undone. If you just want to stop seeing it while keeping everything, try completing it instead of deleting it.',
    'lists.readOnlyBanner': 'This list is completed. You can check notes, expenses and chat, but not add new things.',
    'notes.readOnlyHint': 'Completed list: view only. Reactivate it to add notes.',
    'expenses.readOnlyHint': 'Completed list: view only. Reactivate it to add expenses.',
    'chat.readOnlyHint': 'Completed list: you can only view the chat. Reactivate it to write again.',
    'home.morning': 'Good morning',
    'home.afternoon': 'Good afternoon',
    'home.evening': 'Good evening',
    'home.activeLists': 'active lists',
    'home.pendingNotes': 'pending',
    'home.allDone': 'All caught up 👍',
    'auth.email': 'Email',
    'auth.password': 'Password',
    'auth.forgotPassword': 'Forgot your password?',
    'auth.enter': 'Sign in',
    'auth.entering': 'Signing in…',
    'auth.noAccount': "Don't have an account?",
    'auth.register': 'Sign up',
    'auth.haveAccount': 'Already have an account?',
    'auth.signIn': 'Sign in',
    'auth.appTagline': 'Sign in to see your lists',
    'auth.username': 'Username',
    'auth.usernamePlaceholder': 'How others will see you',
    'auth.createAccount': 'Create account',
    'auth.creatingAccount': 'Creating account…',
    'auth.registerTagline': 'Join to create and share lists',
    'auth.accountCreated': 'Account created!',
    'auth.accountCreatedBody':
      "If your Supabase project requires email confirmation, check your inbox before signing in. If not, you can sign in right away.",
    'auth.goToLogin': 'Go to sign in',
    'auth.recoverPassword': 'Recover password',
    'auth.recoverPasswordBody': "We'll send a link to your email to choose a new password.",
    'auth.recoverPasswordSent':
      "If that email has an account, we've sent a link to choose a new password. Check your inbox (and spam).",
    'auth.sendLink': 'Send link',
    'auth.sending': 'Sending…',
    'auth.understood': 'Got it',
    'theme.light': '☀️ Light',
    'theme.dark': '🌙 Dark',
    'theme.system': '📱 Device',
    'bg.default': 'Default',
    'bg.warm': 'Warm',
    'bg.blue': 'Blue',
    'bg.green': 'Green',
    'bg.pink': 'Pink',
    'bg.purple': 'Purple',
    'bg.yellow': 'Soft yellow',
    'bg.darkVariants': 'Dark tones',
    'profile.usernameUpdated': 'Username updated.',
    'profile.passwordsDontMatch': "The two passwords don't match.",
    'profile.passwordTooShort': 'Password must be at least 6 characters.',
    'profile.passwordUpdated': 'Password updated.',
    'profile.emailConfirmSent':
      "We've sent a confirmation email to the new address. Until you confirm it, you'll keep signing in with the current one.",
  },
} as const

export type TranslationKey = keyof (typeof translations)['es']

type LanguageContextValue = {
  language: Language
  setLanguage: (lang: Language) => void
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string
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

  const t = useCallback(
    (key: TranslationKey, vars?: Record<string, string | number>) => {
      let str: string = translations[language][key] ?? translations.es[key] ?? key
      if (vars) {
        for (const [k, v] of Object.entries(vars)) {
          str = str.replace(`{${k}}`, String(v))
        }
      }
      return str
    },
    [language],
  )

  const value = useMemo(() => ({ language, setLanguage, t }), [language, setLanguage, t])

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}

export function useLanguage() {
  const ctx = useContext(LanguageContext)
  if (!ctx) throw new Error('useLanguage debe usarse dentro de <LanguageProvider>')
  return ctx
}
