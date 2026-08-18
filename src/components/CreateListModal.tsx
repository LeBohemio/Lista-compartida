import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { PALETTE, colorForName } from '../lib/colors'
import { useLanguage, type TranslationKey } from '../lib/i18n'
import { DEFAULT_CURRENCY } from '../lib/currencies'

const TEMPLATES: { emoji: string; labelKey: TranslationKey }[] = [
  { emoji: '🛒', labelKey: 'lists.template.shopping' },
  { emoji: '🧹', labelKey: 'lists.template.chores' },
  { emoji: '✈️', labelKey: 'lists.template.trip' },
  { emoji: '🎁', labelKey: 'lists.template.gifts' },
  { emoji: '🎂', labelKey: 'lists.template.birthday' },
  { emoji: '🎉', labelKey: 'lists.template.party' },
  { emoji: '💼', labelKey: 'lists.template.work' },
  { emoji: '📦', labelKey: 'lists.template.move' },
]

export default function CreateListModal({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: (listId: string) => void
}) {
  const { user, profile } = useAuth()
  const { t } = useLanguage()
  const [name, setName] = useState('')
  const [expensesEnabled, setExpensesEnabled] = useState(false)
  const [color, setColor] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!user) return
    if (!name.trim()) {
      setError(t('list.nameRequired'))
      return
    }
    setSubmitting(true)
    setError(null)

    // Creamos la lista + la membresía del owner mediante una función RPC
    // (SECURITY DEFINER) que deriva el propietario de auth.uid() en el propio
    // servidor, en vez de un INSERT directo desde el cliente.
    const { data: rpcData, error: rpcErr } = await supabase.rpc('create_list_with_owner', {
      p_name: name.trim(),
      p_expenses_enabled: expensesEnabled,
    })
    const list = rpcData as { id: string } | null

    if (rpcErr || !list) {
      setSubmitting(false)
      setError(rpcErr?.message ?? t('lists.createError'))
      return
    }

    // La lista hereda la divisa preferida de tu perfil sin preguntarte nada
    // aquí — se puede cambiar después, por esa lista en concreto, desde sus
    // ajustes si hace falta una distinta.
    await supabase
      .from('lists')
      .update({ color: color ?? colorForName(name.trim()), currency: profile?.currency ?? DEFAULT_CURRENCY })
      .eq('id', list.id)

    setSubmitting(false)
    onCreated(list.id)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div
        className="relative max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-2xl p-6 shadow-xl sm:rounded-2xl bg-[var(--color-surface)]"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          aria-label={t('common.close')}
          title={t('common.close')}
          className="absolute right-4 top-4 rounded-full p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-200"
        >
          ✕
        </button>
        <h2 className="mb-4 pr-8 text-lg font-semibold text-slate-900 dark:text-slate-100">{t('lists.createTitle')}</h2>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">{t('lists.nameFieldLabel')}</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('lists.namePlaceholder')}
              className="w-full rounded-lg border px-3 py-2.5 text-base focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 border-[var(--color-surface-border)] bg-[var(--color-surface-alt)] dark:text-slate-100"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">{t('lists.templatesLabel')}</label>
            <div className="flex flex-wrap gap-2">
              {TEMPLATES.map((tpl) => {
                const tplName = t(tpl.labelKey)
                return (
                  <button
                    type="button"
                    key={tpl.labelKey}
                    onClick={() => setName(tplName)}
                    className={`rounded-full border px-3 py-1.5 text-sm transition ${
                      name === tplName
                        ? 'border-brand-600 bg-brand-50 text-brand-700 dark:border-brand-400 dark:bg-brand-950/40 dark:text-brand-400'
                        : 'text-slate-600 hover:border-brand-300 border-[var(--color-surface-border)] dark:text-slate-300'
                    }`}
                  >
                    {tpl.emoji} {tplName}
                  </button>
                )
              })}
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">{t('lists.colorOptional')}</label>
            <div className="flex flex-wrap gap-2">
              {PALETTE.map((c) => (
                <button
                  type="button"
                  key={c}
                  onClick={() => setColor(c)}
                  aria-label={`Color ${c}`}
                  className="h-8 w-8 rounded-full transition"
                  style={{ backgroundColor: c, boxShadow: color === c ? `0 0 0 2px white, 0 0 0 4px ${c}` : 'none' }}
                />
              ))}
            </div>
          </div>

          <label className="flex items-start gap-3 rounded-lg border p-3 border-[var(--color-surface-border)]">
            <input
              type="checkbox"
              checked={expensesEnabled}
              onChange={(e) => setExpensesEnabled(e.target.checked)}
              className="mt-0.5 h-5 w-5 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
            />
            <span>
              <span className="block text-sm font-medium text-slate-700 dark:text-slate-300">{t('lists.enableExpenses')}</span>
              <span className="block text-xs text-slate-500 dark:text-slate-400">{t('lists.enableExpensesHint')}</span>
            </span>
          </label>

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
              {submitting ? t('lists.creating') : t('lists.createSubmit')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
