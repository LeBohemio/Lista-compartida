import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../lib/i18n'
import { formatCurrency } from '../lib/balances'
import { currencySymbol, type CurrencyCode } from '../lib/currencies'
import type { SuggestedDebt } from '../lib/types'

export default function SettleUpModal({
  listId,
  currency,
  debt,
  fromName,
  toName,
  onClose,
  onSettled,
}: {
  listId: string
  currency: CurrencyCode
  debt: SuggestedDebt
  fromName: string
  toName: string
  onClose: () => void
  onSettled: () => void
}) {
  const { user } = useAuth()
  const { t, language } = useLanguage()
  const [amount, setAmount] = useState(debt.amount.toFixed(2))
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Si quien registra el pago es quien cobra (p. ej. cobró en efectivo y lo
  // apunta ella misma), se da por bueno al momento. Si es el deudor quien lo
  // registra ("ya te he pagado"), queda pendiente de que la otra persona lo
  // confirme, y no cuenta en el balance hasta entonces.
  const autoConfirm = user?.id === debt.to

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!user) return
    const value = Number.parseFloat(amount.replace(',', '.'))
    if (!Number.isFinite(value) || value <= 0) {
      setError(t('settle.errorInvalidAmount'))
      return
    }
    setSubmitting(true)
    setError(null)

    const { error: err } = await supabase.from('settlements').insert({
      list_id: listId,
      from_user: debt.from,
      to_user: debt.to,
      amount: value,
      note: note.trim() || null,
      created_by: user.id,
      confirmed_at: autoConfirm ? new Date().toISOString() : null,
    })

    setSubmitting(false)
    if (err) {
      setError(err.message)
      return
    }
    onSettled()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-t-2xl p-6 shadow-xl sm:rounded-2xl bg-[var(--color-surface)]"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-1 text-lg font-semibold text-slate-900 dark:text-slate-100">{t('settle.title')}</h2>
        <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
          <strong>{fromName}</strong> {t('settle.paysTo')} <strong>{toName}</strong>
          {t('settle.bodyEnd')}
        </p>

        <p
          className={`mb-4 rounded-lg px-3 py-2 text-xs ${
            autoConfirm
              ? 'bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-400'
              : 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400'
          }`}
        >
          {autoConfirm ? t('settle.autoConfirmNote') : t('settle.pendingConfirmNote', { name: toName })}
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
              {t('settle.amount', { symbol: currencySymbol(currency) })}
            </label>
            <input
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full rounded-lg border px-3 py-2.5 text-base focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 border-[var(--color-surface-border)] bg-[var(--color-surface-alt)] dark:text-slate-100"
            />
            <p className="mt-1 text-xs text-slate-400">
              {t('settle.suggestedDebt', { amount: formatCurrency(debt.amount, currency, language) })}
            </p>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">{t('settle.note')}</label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t('settle.notePlaceholder')}
              className="w-full rounded-lg border px-3 py-2.5 text-base focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 border-[var(--color-surface-border)] bg-[var(--color-surface-alt)] dark:text-slate-100"
            />
          </div>

          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/40 dark:text-red-400">{error}</p>}

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
              {submitting ? t('common.saving') : t('settle.confirm')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
