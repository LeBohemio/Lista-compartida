import { lazy, Suspense, useEffect } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import { useLanguage } from './lib/i18n'
import { applyTheme } from './lib/theme'
import OfflineBanner from './components/OfflineBanner'
import ProtectedRoute from './components/ProtectedRoute'
import MainLayout from './components/MainLayout'
import SwipeDebugOverlay from './components/SwipeDebugOverlay'

// "Mis listas" es la primera pantalla que ve casi todo el mundo (tanto justo
// tras entrar como cada vez que se reabre la PWA con la sesión ya
// guardada), así que se queda cargada de golpe con el resto de la app,
// igual que LoginPage para quien todavía no ha entrado — ninguna de las dos
// debe esperar a una descarga extra justo en el primer pantallazo.
//
// El resto de pantallas (todas las que se abren DESPUÉS de esa primera, con
// un toque) se cargan bajo demanda con lazy() — así su código no forma
// parte del paquete inicial que se descarga al abrir la app. Es el mismo
// principio que aplicamos a tesseract.js en lib/ocr.ts, llevado esta vez a
// pantallas enteras en vez de a una sola librería.
import LoginPage from './pages/LoginPage'
import ListsPage from './pages/ListsPage'
const RegisterPage = lazy(() => import('./pages/RegisterPage'))
const ResetPasswordPage = lazy(() => import('./pages/ResetPasswordPage'))
const PrivacyPolicyPage = lazy(() => import('./pages/PrivacyPolicyPage'))
const AccountDeletionPage = lazy(() => import('./pages/AccountDeletionPage'))
const ListDetailPage = lazy(() => import('./pages/ListDetailPage'))
const NotesPage = lazy(() => import('./pages/NotesPage'))
const NoteDetailPage = lazy(() => import('./pages/NoteDetailPage'))
const ContactsPage = lazy(() => import('./pages/ContactsPage'))
const DirectChatPage = lazy(() => import('./pages/DirectChatPage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))

function RouteFallback() {
  const { t } = useLanguage()
  return (
    <div className="flex h-full min-h-screen items-center justify-center bg-[var(--color-surface-alt)]">
      <p className="text-slate-500 dark:text-slate-400">{t('common.loading')}</p>
    </div>
  )
}

function App() {
  const { loading, profile } = useAuth()
  const { t } = useLanguage()

  useEffect(() => {
    const theme = profile?.theme ?? 'system'
    const backgroundColor = profile?.background_color ?? null
    applyTheme(theme, profile?.accent_color ?? null, backgroundColor)
    if (theme !== 'system' || backgroundColor) return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => applyTheme('system', profile?.accent_color ?? null, backgroundColor)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [profile?.theme, profile?.accent_color, profile?.background_color])

  if (loading) {
    return (
      <div className="flex h-full min-h-screen items-center justify-center bg-[var(--color-surface-alt)]">
        <p className="text-slate-500 dark:text-slate-400">{t('common.loading')}</p>
      </div>
    )
  }

  return (
    <>
      {/* Temporal, para diagnosticar lo del deslizar — ver swipeDebug.ts. */}
      <SwipeDebugOverlay />
      <OfflineBanner />
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          {/*
            Públicas a propósito, sin ProtectedRoute — Google Play exige poder
            abrir la política de privacidad y pedir el borrado de cuenta sin
            tener la app instalada ni sesión iniciada. Ver PrivacyPolicyPage.tsx
            / AccountDeletionPage.tsx.
          */}
          <Route path="/legal/privacidad" element={<PrivacyPolicyPage />} />
          <Route path="/legal/borrar-cuenta" element={<AccountDeletionPage />} />

          {/*
            Las 3 pantallas principales comparten MainLayout, que pinta la
            barra de navegación inferior (Mis listas / Contactos / Ajustes) de
            forma persistente alrededor de la que toque vía <Outlet />. El
            detalle de una lista se queda fuera de este grupo a propósito —
            igual que en apps de chat, al abrir "una cosa concreta" se
            muestra a pantalla completa, sin la barra de pestañas encima.
          */}
          <Route
            element={
              <ProtectedRoute>
                <MainLayout />
              </ProtectedRoute>
            }
          >
            <Route path="/lists" element={<ListsPage />} />
            <Route path="/notes" element={<NotesPage />} />
            <Route path="/contacts" element={<ContactsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>

          <Route
            path="/lists/:listId"
            element={
              <ProtectedRoute>
                <ListDetailPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/contacts/:userId/chat"
            element={
              <ProtectedRoute>
                <DirectChatPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/notes/:noteId"
            element={
              <ProtectedRoute>
                <NoteDetailPage />
              </ProtectedRoute>
            }
          />
          <Route path="/" element={<Navigate to="/lists" replace />} />
          <Route path="*" element={<Navigate to="/lists" replace />} />
        </Routes>
      </Suspense>
    </>
  )
}

export default App
