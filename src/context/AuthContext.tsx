import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabaseClient'
import type { Profile } from '../lib/types'

type AuthContextValue = {
  session: Session | null
  user: User | null
  profile: Profile | null
  loading: boolean
  signUp: (email: string, password: string, username: string) => Promise<{ error: string | null }>
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  const loadProfile = async (userId: string) => {
    const { data } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle()
    setProfile(data ?? null)
  }

  useEffect(() => {
    let mounted = true

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return
      setSession(data.session)
      postSessionToServiceWorker(data.session)
      if (data.session?.user) {
        loadProfile(data.session.user.id).finally(() => setLoading(false))
      } else {
        setLoading(false)
      }
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
      postSessionToServiceWorker(newSession)
      if (newSession?.user) {
        loadProfile(newSession.user.id)
      } else {
        setProfile(null)
      }
    })

    return () => {
      mounted = false
      sub.subscription.unsubscribe()
    }
  }, [])

  const signUp: AuthContextValue['signUp'] = async (email, password, username) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { username } },
    })
    if (error) return { error: translateAuthError(error.message) }
    return { error: null }
  }

  const signIn: AuthContextValue['signIn'] = async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) return { error: translateAuthError(error.message) }
    return { error: null }
  }

  const signOut = async () => {
    await supabase.auth.signOut()
  }

  const refreshProfile = async () => {
    if (session?.user) await loadProfile(session.user.id)
  }

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        profile,
        loading,
        signUp,
        signIn,
        signOut,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>')
  return ctx
}

// Este contexto vive por encima de LanguageProvider (que a su vez depende de
// useAuth), así que no podemos usar useLanguage()/t() aquí sin crear una
// dependencia circular. Leemos el idioma guardado directamente de
// localStorage — es el mismo valor que usa i18n.tsx como semilla inicial.
function getAuthErrorLanguage(): 'en' | 'es' {
  if (typeof window === 'undefined') return 'es'
  const stored = window.localStorage.getItem('listas-en-comun-language')
  return stored === 'en' ? 'en' : 'es'
}

// Le cuenta al Service Worker cuál es la sesión activa ahora mismo, para que
// pueda marcar conversaciones como leídas desde el botón de una notificación
// aunque la app esté cerrada (ver el comentario junto a AUTH_DB_NAME en
// src/sw.ts — el Service Worker no puede leer el localStorage de la página,
// así que es la propia app la que se lo tiene que mandar cada vez que
// cambia: entrar, salir, o que supabase-js refresque el token en segundo
// plano). Si no hay sesión (o no hay Service Worker todavía) se manda
// "null" para que el aviso guardado se borre y no se intente usar un token
// de una sesión ya cerrada.
function postSessionToServiceWorker(session: Session | null) {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return

  const payload = session?.access_token && session.refresh_token && session.user
    ? {
        accessToken: session.access_token,
        refreshToken: session.refresh_token,
        expiresAt: session.expires_at ?? Math.floor(Date.now() / 1000) + (session.expires_in ?? 3600),
        userId: session.user.id,
        language: getAuthErrorLanguage(),
      }
    : null

  navigator.serviceWorker.ready
    .then((registration) => {
      registration.active?.postMessage({ type: 'AUTH_SESSION', session: payload })
    })
    .catch(() => {
      // Sin Service Worker activo (por ejemplo, en un navegador sin soporte
      // o justo durante el primer arranque) no hay nada que avisar.
    })
}

function translateAuthError(message: string): string {
  const m = message.toLowerCase()
  const lang = getAuthErrorLanguage()

  if (lang === 'en') {
    if (m.includes('already registered') || m.includes('already exists')) {
      return 'An account with that email already exists.'
    }
    if (m.includes('invalid login credentials')) {
      return 'Incorrect email or password.'
    }
    if (m.includes('email') && m.includes('not confirmed')) {
      return 'Confirm your email first — check your inbox for the confirmation link we sent you.'
    }
    if (m.includes('password') && m.includes('least')) {
      return 'Password must be at least 6 characters long.'
    }
    if (m.includes('email') && m.includes('invalid')) {
      return 'That email is not valid.'
    }
    return message
  }

  if (m.includes('already registered') || m.includes('already exists')) {
    return 'Ya existe una cuenta con ese email.'
  }
  if (m.includes('invalid login credentials')) {
    return 'Email o contraseña incorrectos.'
  }
  if (m.includes('email') && m.includes('not confirmed')) {
    return 'Confirma tu email antes de entrar — revisa tu bandeja de entrada, te mandamos un enlace de confirmación.'
  }
  if (m.includes('password') && m.includes('least')) {
    return 'La contraseña debe tener al menos 6 caracteres.'
  }
  if (m.includes('email') && m.includes('invalid')) {
    return 'El email no es válido.'
  }
  return message
}
