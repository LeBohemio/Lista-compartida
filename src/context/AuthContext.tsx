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
    const lang = getAuthErrorLanguage()
    const normalizedEmail = email.trim().toLowerCase()

    const precheck = await checkAuthRateLimit('signup', normalizedEmail)
    if (precheck?.locked) {
      return { error: formatLockoutMessage(precheck.seconds_remaining, lang) }
    }

    // Contamos el intento ANTES de llamar a Supabase, así un script que
    // dispara registros muy rápido no consigue colarse entre la comprobación
    // y el conteo (evita la típica carrera de "comprobar y luego actuar").
    const attempt = await registerAuthAttempt('signup', normalizedEmail)
    if (attempt?.locked) {
      return { error: formatLockoutMessage(attempt.seconds_remaining, lang) }
    }

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { username } },
    })
    if (error) return { error: translateAuthError(error.message) }
    return { error: null }
  }

  const signIn: AuthContextValue['signIn'] = async (email, password) => {
    const lang = getAuthErrorLanguage()
    const normalizedEmail = email.trim().toLowerCase()

    const precheck = await checkAuthRateLimit('login', normalizedEmail)
    if (precheck?.locked) {
      return { error: formatLockoutMessage(precheck.seconds_remaining, lang) }
    }

    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      const attempt = await registerAuthAttempt('login', normalizedEmail)
      if (attempt?.locked) {
        return { error: formatLockoutMessage(attempt.seconds_remaining, lang) }
      }
      const translated = translateAuthError(error.message)
      if (attempt) {
        return { error: appendAttemptsRemaining(translated, attempt.attempts_remaining, lang) }
      }
      return { error: translated }
    }

    clearAuthRateLimit('login', normalizedEmail)
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

// ----------------------------------------------------------------------------
// Protección básica contra fuerza bruta (login) y contra registros repetidos
// a lo loco (signup) — ver migration_v39.sql. Todo el conteo vive en la base
// de datos (tabla auth_rate_limits + funciones RPC), aquí solo se llama a
// esas funciones y se traduce el resultado a un mensaje para la persona.
//
// Límites elegidos: en login, 5 contraseñas incorrectas seguidas (en una
// ventana de 15 minutos) bloquean ESE email 15 minutos — igual que hacen la
// mayoría de apps con inicio de sesión. En signup, 5 intentos de registro
// con el mismo email en 15 minutos bloquean ese email otros 15 minutos —
// pensado sobre todo para frenar un script que insiste una y otra vez con
// la misma dirección, no para parar a alguien que se equivoca una vez.
const LOGIN_MAX_ATTEMPTS = 5
const LOGIN_WINDOW_MINUTES = 15
const LOGIN_LOCKOUT_MINUTES = 15
const SIGNUP_MAX_ATTEMPTS = 5
const SIGNUP_WINDOW_MINUTES = 15
const SIGNUP_LOCKOUT_MINUTES = 15

function formatLockoutMessage(secondsRemaining: number, lang: 'en' | 'es'): string {
  const minutes = Math.max(1, Math.ceil(secondsRemaining / 60))
  if (lang === 'en') {
    return minutes === 1
      ? 'Too many attempts. Try again in 1 minute.'
      : `Too many attempts. Try again in ${minutes} minutes.`
  }
  return minutes === 1
    ? 'Demasiados intentos. Vuelve a intentarlo en 1 minuto.'
    : `Demasiados intentos. Vuelve a intentarlo en ${minutes} minutos.`
}

function appendAttemptsRemaining(message: string, attemptsRemaining: number, lang: 'en' | 'es'): string {
  // Solo lo añadimos cuando ya quedan pocos, para no ser alarmistas desde
  // el primer fallo — a partir de 2 intentos restantes sí merece la pena
  // avisar de que la cuenta se va a bloquear pronto.
  if (attemptsRemaining > 2) return message
  if (lang === 'en') {
    return `${message} (${attemptsRemaining} attempt${attemptsRemaining === 1 ? '' : 's'} left before a temporary lock.)`
  }
  return `${message} (te queda${attemptsRemaining === 1 ? '' : 'n'} ${attemptsRemaining} intento${attemptsRemaining === 1 ? '' : 's'} antes de un bloqueo temporal.)`
}

type RateLimitCheck = { locked: boolean; seconds_remaining: number }
type RateLimitAttempt = { locked: boolean; seconds_remaining: number; attempts_remaining: number }

async function checkAuthRateLimit(kind: 'login' | 'signup', email: string): Promise<RateLimitCheck | null> {
  const { data, error } = await supabase.rpc('check_auth_rate_limit', { p_kind: kind, p_email: email })
  if (error || !data || data.length === 0) return null
  return data[0] as RateLimitCheck
}

async function registerAuthAttempt(kind: 'login' | 'signup', email: string): Promise<RateLimitAttempt | null> {
  const isLogin = kind === 'login'
  const { data, error } = await supabase.rpc('register_auth_attempt', {
    p_kind: kind,
    p_email: email,
    p_max_attempts: isLogin ? LOGIN_MAX_ATTEMPTS : SIGNUP_MAX_ATTEMPTS,
    p_window_minutes: isLogin ? LOGIN_WINDOW_MINUTES : SIGNUP_WINDOW_MINUTES,
    p_lockout_minutes: isLogin ? LOGIN_LOCKOUT_MINUTES : SIGNUP_LOCKOUT_MINUTES,
  })
  if (error || !data || data.length === 0) return null
  return data[0] as RateLimitAttempt
}

function clearAuthRateLimit(kind: 'login' | 'signup', email: string) {
  // No bloqueamos la respuesta de un login/registro correcto esperando a
  // esto — si falla, lo peor que pasa es que el contador tarde un poco más
  // en limpiarse solo (se resetea igualmente en cuanto pase la ventana).
  supabase.rpc('clear_auth_rate_limit', { p_kind: kind, p_email: email }).then(({ error }) => {
    if (error) console.error('[auth_rate_limits] no se pudo limpiar el contador:', error)
  })
}
