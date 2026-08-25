import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useLanguage } from '../lib/i18n'
import { PALETTE } from '../lib/colors'

export default function CreateNoteModal({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: (noteId: string) => void
}) {
  const { t } = useLanguage()
  const [title, setTitle] = useState('')
  // Sin elegir por defecto: si no se toca ningún color, la nota se queda
  // con uno estable calculado a partir del título (ver colorForNote) — el
  // mismo criterio que ya tienen las listas.
  const [color, setColor] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!title.trim()) {
      setError(t('apuntes.titleRequired'))
      return
    }
    setSubmitting(true)
    setError(null)

    // Misma idea que create_list_with_owner: crea la nota + la membresía
    // del creador como owner en un único paso atómico en el servidor.
    const { data, error: rpcErr } = await supabase.rpc('create_note_with_owner', { p_title: title.trim() })
    const note = data as { id: string } | null

    if (rpcErr || !note) {
      setSubmitting(false)
      setError(rpcErr?.message ?? t('apuntes.createError'))
      return
    }

    // El color es aparte porque create_note_with_owner ya existía sin este
    // parámetro (ver migration_v23.sql) — tocar la función de la base de
    // datos para añadírselo habría hecho falta una migración nueva solo
    // para esto. Un update justo después, con el mismo permiso que ya
    // tiene cualquier miembro sobre su propia nota recién creada (ver
    // migration_v32.sql), es más simple y hace exactamente lo mismo.
    if (color) {
      await supabase.from('notes').update({ color }).eq('id', note.id)
    }

    setSubmitting(false)
    onCreated(note.id)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div
        className="glass-panel w-full max-w-md rounded-t-[28px] p-6 shadow-[0_24px_60px_-20px_rgba(20,21,26,0.5)] sm:rounded-[28px]"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-lg font-semibold text-slate-900 dark:text-slate-100">{t('apuntes.createTitle')}</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
              {t('apuntes.titleLabel')}
            </label>
            <input
              type="text"
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('apuntes.titlePlaceholder')}
              className="w-full rounded-2xl border px-3 py-2.5 text-base focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 border-[var(--color-glass-border)] bg-[var(--color-glass)] dark:text-slate-100"
            />
          </div>

          <div>
            {/* "Color" sin traducir a propósito, igual que en
                RenameListModal.tsx — es la misma palabra en los dos
                idiomas de la app. */}
            <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">Color</label>
            <div className="flex flex-wrap gap-2">
              {PALETTE.map((c) => (
                <button
                  type="button"
                  key={c}
                  onClick={() => setColor((cur) => (cur === c ? null : c))}
                  aria-label={`Color ${c}`}
                  className="h-8 w-8 rounded-full transition"
                  style={{ backgroundColor: c, boxShadow: color === c ? `0 0 0 2px white, 0 0 0 4px ${c}` : 'none' }}
                />
              ))}
            </div>
          </div>

          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/40 dark:text-red-400">
              {error}
            </p>
          )}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-full border px-4 py-2.5 font-medium text-slate-700 hover:bg-white/60 border-[var(--color-glass-border)] dark:text-slate-200 dark:hover:bg-white/10"
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 rounded-full bg-gradient-to-br from-[var(--color-brand-500)] to-[var(--color-brand-600)] px-4 py-2.5 font-medium text-white shadow-[0_10px_22px_-10px_var(--color-glow)] disabled:opacity-60"
            >
              {submitting ? t('common.saving') : t('apuntes.createSubmit')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
