import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'

const TEMPLATES = [
  { label: '🛒 Compra', name: 'Compra' },
  { label: '🧹 Tareas de casa', name: 'Tareas de casa' },
  { label: '✈️ Viaje', name: 'Viaje' },
  { label: '🎁 Regalos', name: 'Regalos' },
]

export default function CreateListModal({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: (listId: string) => void
}) {
  const { user } = useAuth()
  const [name, setName] = useState('')
  const [expensesEnabled, setExpensesEnabled] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!user) return
    if (!name.trim()) {
      setError('Ponle un nombre a la lista.')
      return
    }
    setSubmitting(true)
    setError(null)

    // Comprobación defensiva: nos aseguramos de que hay una sesión activa y
    // válida justo antes de escribir, y usamos su user.id (no el del contexto,
    // por si estuviera obsoleto) para descartar problemas de sesión caducada.
    const { data: sessionData, error: sessionErr } = await supabase.auth.getSession()
    const activeUser = sessionData.session?.user ?? null
    if (sessionErr || !activeUser) {
      setError(
        `No se detecta una sesión válida (sessionErr: ${sessionErr?.message ?? 'ninguno'}). Cierra sesión y vuelve a entrar.`,
      )
      setSubmitting(false)
      return
    }

    const { data: list, error: listErr } = await supabase
      .from('lists')
      .insert({ name: name.trim(), owner_id: activeUser.id, expenses_enabled: expensesEnabled })
      .select()
      .single()

    if (listErr || !list) {
      setError(
        `${listErr?.message ?? 'No se pudo crear la lista.'} [debug: user.id=${activeUser.id}, contexto.id=${user.id}, coinciden=${activeUser.id === user.id}]`,
      )
      setSubmitting(false)
      return
    }

    const { error: memberErr } = await supabase.from('list_members').insert({
      list_id: list.id,
      user_id: activeUser.id,
      role: 'owner',
      status: 'accepted',
      invited_identifier: activeUser.email ?? '',
      responded_at: new Date().toISOString(),
    })

    setSubmitting(false)
    if (memberErr) {
      setError(memberErr.message)
      return
    }
    onCreated(list.id)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-6 shadow-xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-lg font-semibold text-slate-900">Nueva lista</h2>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">Plantillas sugeridas</label>
            <div className="flex flex-wrap gap-2">
              {TEMPLATES.map((t) => (
                <button
                  type="button"
                  key={t.name}
                  onClick={() => setName(t.name)}
                  className={`rounded-full border px-3 py-1.5 text-sm transition ${
                    name === t.name
                      ? 'border-brand-600 bg-brand-50 text-brand-700'
                      : 'border-slate-300 text-slate-600 hover:border-brand-300'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Nombre de la lista</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Escribe un nombre libre o elige una plantilla"
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-base focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
            />
          </div>

          <label className="flex items-start gap-3 rounded-lg border border-slate-200 p-3">
            <input
              type="checkbox"
              checked={expensesEnabled}
              onChange={(e) => setExpensesEnabled(e.target.checked)}
              className="mt-0.5 h-5 w-5 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
            />
            <span>
              <span className="block text-sm font-medium text-slate-700">Activar gastos compartidos</span>
              <span className="block text-xs text-slate-500">
                Podrás subir tickets y repartir gastos entre los miembros. Si no lo activas ahora, podrás hacerlo
                más adelante desde la lista.
              </span>
            </span>
          </label>

          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-lg border border-slate-300 px-4 py-2.5 font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 rounded-lg bg-brand-600 px-4 py-2.5 font-medium text-white hover:bg-brand-700 disabled:opacity-60"
            >
              {submitting ? 'Creando…' : 'Crear lista'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
