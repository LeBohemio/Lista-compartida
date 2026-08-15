import { useEffect } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import { applyTheme } from './lib/theme'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'
import ResetPasswordPage from './pages/ResetPasswordPage'
import ListsPage from './pages/ListsPage'
import ListDetailPage from './pages/ListDetailPage'
import ProtectedRoute from './components/ProtectedRoute'

function App() {
  const { loading, profile } = useAuth()

  useEffect(() => {
    const theme = profile?.theme ?? 'system'
    applyTheme(theme, profile?.accent_color ?? null)
    if (theme !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => applyTheme('system', profile?.accent_color ?? null)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [profile?.theme, profile?.accent_color])

  if (loading) {
    return (
      <div className="flex h-full min-h-screen items-center justify-center bg-slate-50 dark:bg-[var(--color-surface-alt)]">
        <p className="text-slate-500 dark:text-slate-400">Cargando…</p>
      </div>
    )
  }

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route
        path="/lists"
        element={
          <ProtectedRoute>
            <ListsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/lists/:listId"
        element={
          <ProtectedRoute>
            <ListDetailPage />
          </ProtectedRoute>
        }
      />
      <Route path="/" element={<Navigate to="/lists" replace />} />
      <Route path="*" element={<Navigate to="/lists" replace />} />
    </Routes>
  )
}

export default App
