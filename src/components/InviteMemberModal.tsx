import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabaseClient'

export default function InviteMemberModal({
  listId,
  onClose,
  onInvited,
}: {
  listId: string
  onClose: () => void
  onInvited: () => void
}) {
  const [identifier, setIdentifier] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setSuccess(null)
    const value = identifier.trim().toLowerCase()
    if (!value) return
    setSubmitting(true)

    const { data: profile, error: findErr } = await supabase
      .from('profiles')
      .select('*')
      .or(`email.eq.${value},username.eq.${value}`)
      .maybeSingle()

    if (findErr) {
      setError(findErr.message)
      setSubmitting(false)
      return
    }
    if (!profile) {
      setError('No existe ningún usuario registrado con ese email o nombre de usuario. Pídele que se registre primero.')
      setSubmitting(false)
      return
    }

    const { error: insertErr } = await supabase.from('list_members').insert({
      list_id: listId,
      user_id: profile.id,
      role: 'member',
      status: 'invited',
      invited_identifier: value,
    })

    setSubmitting(false)
    if (insertErr) {
      if (insertErr.code === '23505') {
        setError('Esa persona ya es miembro o ya tiene una invitación pendiente en esta lista.')
      } else {
        setError(insertErr.message)
      }
      return
    }

    setSuccess(`Invitación enviada a ${profile.username}.`)
    setIdentifier('')
    onInvited()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-t-2xl bg-white p-6 shadow-xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-1 text-lg font-semibold text-slate-900">Invitar a la lista</h2>
        <p className="mb-4 text-sm text-slate-500">
          Introduce el email o el nombre de usuario de alguien ya registrado en la app.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="text"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            placeholder="email@ejemplo.com o usuario"
            className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-base focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
          />

          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
          {success && <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">{success}</p>}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-lg border border-slate-300 px-4 py-2.5 font-medium text-slate-700 hover:bg-slate-50"
            >
              Cerrar
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 rounded-lg bg-brand-600 px-4 py-2.5 font-medium text-white hover:bg-brand-700 disabled:opacity-60"
            >
              {submitting ? 'Invitando…' : 'Invitar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
