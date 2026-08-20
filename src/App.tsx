import { useEffect } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import { useLanguage } from './lib/i18n'
import { applyTheme } from './lib/theme'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'
import ResetPasswordPage from './pages/ResetPasswordPage'
import ListsPage from './pages/ListsPage'
import ListDetailPage from './pages/ListDetailPage'
import NotesPage from './pages/NotesPage'
import NoteDetailPage from './pages/NoteDetailPage'
import ContactsPage from './pages/ContactsPage'
import DirectChatPage from './pages/DirectChatPage'
import SettingsPage from './pages/SettingsPage'
import ProtectedRoute from './components/ProtectedRoute'
import MainLayout from './components/MainLayout'

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
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />

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
  )
}

export default App
