import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'
import ListsPage from './pages/ListsPage'
import ListDetailPage from './pages/ListDetailPage'
import ProtectedRoute from './components/ProtectedRoute'

function App() {
  const { loading } = useAuth()

  if (loading) {
    return (
      <div className="flex h-full min-h-screen items-center justify-center bg-slate-50">
        <p className="text-slate-500">Cargando…</p>
      </div>
    )
  }

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
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
