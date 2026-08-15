import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'

export default function DeleteAccountDialog({ onClose }: { onClose: () => void }) {
  const { signOut } = useAuth()
  const navigate = useNavigate()
  const [confirmText, setConfirmText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canDelete = confirmText.trim().toUpperCase() === 'ELIMINAR'

  const handleDelete = async () => {
    if (!canDelete) return
    setSubmitting(true)
    setError(null)
    const { error: err } = await supabase.rpc('delete_own_account')
    if (err) {
      setSubmitting(false)
      setError(err.message)
      return
    }
    await signOut()
    navigate('/login')
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-t-2xl p-6 shadow-xl sm:rounded-2xl bg-[var(--color-surface)]"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-2 text-lg font-semibold text-red-600">Eliminar cuenta</h2>
        <p className="mb-3 text-sm text-slate-600 dark:text-slate-300">
          Esto borra tu cuenta para siempre. Si eres creador de alguna lista con más gente, la propiedad pasará
          automáticamente al miembro más antiguo. Si estabas solo en una lista, esa lista se borrará contigo. No hay
          vuelta atrás.
        </p>
        <p className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-200">
          Escribe <span className="font-bold">ELIMINAR</span> para confirmar:
        </p>
        <input
          type="text"
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          className="mb-4 w-full rounded-lg border px-3 py-2.5 text-base focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-100 border-[var(--color-surface-border)] bg-[var(--color-surface-alt)] dark:text-slate-100"
          placeholder="ELIMINAR"
        />

        {error && <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950">{error}</p>}

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 rounded-lg border px-4 py-2.5 font-medium text-slate-700 hover:bg-slate-50 border-[var(--color-surface-border)] dark:text-slate-200 dark:hover:bg-slate-700"
          >
            Cancelar
          </button>
          <button
            onClick={handleDelete}
            disabled={!canDelete || submitting}
            className="flex-1 rounded-lg bg-red-600 px-4 py-2.5 font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            {submitting ? 'Eliminando…' : 'Eliminar cuenta'}
          </button>
        </div>
      </div>
    </div>
  )
}
