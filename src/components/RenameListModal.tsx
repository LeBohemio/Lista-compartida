import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabaseClient'
import { PALETTE } from '../lib/colors'
import { CURRENCIES, type CurrencyCode } from '../lib/currencies'
import { useLanguage } from '../lib/i18n'

export default function RenameListModal({
  listId,
  currentName,
  currentColor,
  currentCurrency,
  onClose,
  onSaved,
}: {
  listId: string
  currentName: string
  currentColor: string | null
  currentCurrency: CurrencyCode
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useLanguage()
  const [name, setName] = useState(currentName)
  const [color, setColor] = useState<string | null>(currentColor)
  const [currency, setCurrency] = useState<CurrencyCode>(currentCurrency)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      setError(t('list.nameRequired'))
      return
    }
    setSubmitting(true)
    setError(null)
    const { error: err } = await supabase.from('lists').update({ name: name.trim(), color, currency }).eq('id', listId)
    setSubmitting(false)
    if (err) {
      setError(err.message)
      return
    }
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-t-2xl p-6 shadow-xl sm:rounded-2xl bg-[var(--color-surface)]"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-lg font-semibold text-slate-900 dark:text-slate-100">{t('list.editTitle')}</h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">{t('list.name')}</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border px-3 py-2.5 text-base focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 border-[var(--color-surface-border)] bg-[var(--color-surface-alt)] dark:text-slate-100"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">Color</label>
            <div className="flex flex-wrap gap-2">
              {PALETTE.map((c) => (
                <button
                  type="button"
                  key={c}
                  onClick={() => setColor(c)}
                  aria-label={`Color ${c}`}
                  className="h-8 w-8 rounded-full ring-offset-2 transition"
                  style={{ backgroundColor: c, boxShadow: color === c ? `0 0 0 2px white, 0 0 0 4px ${c}` : 'none' }}
                />
              ))}
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">{t('profile.currency')}</label>
            <div className="flex flex-wrap gap-2">
              {CURRENCIES.map((c) => (
                <button
                  type="button"
                  key={c.code}
                  onClick={() => setCurrency(c.code)}
                  className={`rounded-full border px-3 py-1.5 text-sm font-medium transition ${
                    currency === c.code
                      ? 'border-brand-600 bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-400'
                      : 'text-slate-600 hover:border-brand-300 border-[var(--color-surface-border)] dark:text-slate-300'
                  }`}
                >
                  {c.flag} {c.code}
                </button>
              ))}
            </div>
          </div>

          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950">{error}</p>}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-lg border px-4 py-2.5 font-medium text-slate-700 hover:bg-slate-50 border-[var(--color-surface-border)] dark:text-slate-200 dark:hover:bg-slate-700"
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 rounded-lg bg-brand-600 px-4 py-2.5 font-medium text-white hover:bg-brand-700 disabled:opacity-60"
            >
              {submitting ? t('common.saving') : t('common.save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
