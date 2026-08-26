import { useMemo, useRef, useState, type MouseEvent } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../lib/i18n'
import { useToast } from '../context/ToastContext'
import { formatCurrency } from '../lib/balances'
import type { CurrencyCode } from '../lib/currencies'
import type { Expense, ExpenseCategory, ListMember, Settlement } from '../lib/types'
import NewExpenseModal from './NewExpenseModal'
import BalanceSummary from './BalanceSummary'
import Avatar from './Avatar'
import UndoToast from './UndoToast'
import { CheckIcon, CloseIcon, EditIcon, FileAttachmentIcon, HandshakeIcon, LockIcon, TrashIcon } from './icons'
import { EXPENSE_CATEGORIES, categoryIcon } from '../lib/categories'
import { formatFileSize } from '../lib/files'

const UNDO_DELAY_MS = 5000
const SEARCH_THRESHOLD = 8

type LedgerRow =
  | { kind: 'expense'; date: string; data: Expense }
  | { kind: 'settlement'; date: string; data: Settlement }

export default function ExpensesPanel({
  listId,
  currency,
  members,
  expenses,
  settlements,
  soloList,
  readOnly,
}: {
  listId: string
  currency: CurrencyCode
  members: ListMember[]
  expenses: Expense[]
  settlements: Settlement[]
  soloList: boolean
  readOnly?: boolean
}) {
  const { user } = useAuth()
  const { t, language } = useLanguage()
  const { showError } = useToast()
  const [showNew, setShowNew] = useState(false)
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [receiptUrl, setReceiptUrl] = useState<string | null>(null)
  const [attachmentUrl, setAttachmentUrl] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<ExpenseCategory | null>(null)

  const [pendingDeleteIds, setPendingDeleteIds] = useState<Set<string>>(new Set())
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const [lastPendingId, setLastPendingId] = useState<string | null>(null)

  const visibleExpenses = expenses.filter((e) => !pendingDeleteIds.has(e.id))

  // Total gastado en la lista, sin más — no es lo mismo que el balance (qué
  // le debe cada uno a quién), así que se muestra aparte y bien visible,
  // arriba del todo.
  const totalSpent = useMemo(
    () => visibleExpenses.reduce((sum, e) => sum + Number(e.total_amount), 0),
    [visibleExpenses],
  )

  const categoryTotals = useMemo(() => {
    const sums = new Map<string, number>()
    for (const e of visibleExpenses) {
      sums.set(e.category, (sums.get(e.category) ?? 0) + Number(e.total_amount))
    }
    return EXPENSE_CATEGORIES.map((c) => ({ ...c, total: sums.get(c.value) ?? 0 }))
      .filter((c) => c.total > 0)
      .sort((a, b) => b.total - a.total)
  }, [visibleExpenses])

  // El histórico solo lleva pagos YA confirmados — uno pendiente de
  // confirmar ya se ve (y se puede confirmar/rechazar) en el aviso de
  // arriba, dentro de BalanceSummary. Meterlo también aquí, sin poder
  // actuar sobre él, era duplicar la misma información dos veces.
  const ledger: LedgerRow[] = [
    ...visibleExpenses.map((e) => ({ kind: 'expense' as const, date: e.created_at, data: e })),
    ...settlements.filter((s) => s.confirmed_at).map((s) => ({ kind: 'settlement' as const, date: s.created_at, data: s })),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

  const filteredLedger = ledger.filter((row) => {
    if (categoryFilter && (row.kind !== 'expense' || row.data.category !== categoryFilter)) return false
    if (!search.trim()) return true
    const q = search.trim().toLowerCase()
    if (row.kind === 'expense') {
      return (
        (row.data.description ?? '').toLowerCase().includes(q) ||
        (row.data.payer?.username ?? '').toLowerCase().includes(q)
      )
    }
    return (
      (row.data.note ?? '').toLowerCase().includes(q) ||
      (row.data.from_profile?.username ?? '').toLowerCase().includes(q) ||
      (row.data.to_profile?.username ?? '').toLowerCase().includes(q)
    )
  })

  const toggleExpand = async (expense: Expense) => {
    if (expandedId === expense.id) {
      setExpandedId(null)
      setReceiptUrl(null)
      setAttachmentUrl(null)
      return
    }
    setExpandedId(expense.id)
    setReceiptUrl(null)
    setAttachmentUrl(null)
    if (expense.receipt_image_path) {
      const { data } = await supabase.storage.from('receipts').createSignedUrl(expense.receipt_image_path, 3600)
      setReceiptUrl(data?.signedUrl ?? null)
    }
    if (expense.file_path) {
      const { data } = await supabase.storage.from('expense-files').createSignedUrl(expense.file_path, 3600)
      setAttachmentUrl(data?.signedUrl ?? null)
    }
  }

  const requestDelete = (e: MouseEvent, expenseId: string) => {
    e.stopPropagation()
    setPendingDeleteIds((prev) => new Set(prev).add(expenseId))
    setLastPendingId(expenseId)
    const timer = setTimeout(async () => {
      timersRef.current.delete(expenseId)
      const { error: err } = await supabase.from('expenses').delete().eq('id', expenseId)
      if (err) showError(t('common.deleteError'))
      setPendingDeleteIds((prev) => {
        const next = new Set(prev)
        next.delete(expenseId)
        return next
      })
      setLastPendingId((cur) => (cur === expenseId ? null : cur))
    }, UNDO_DELAY_MS)
    timersRef.current.set(expenseId, timer)
  }

  const undoDelete = (expenseId: string) => {
    const timer = timersRef.current.get(expenseId)
    if (timer) {
      clearTimeout(timer)
      timersRef.current.delete(expenseId)
    }
    setPendingDeleteIds((prev) => {
      const next = new Set(prev)
      next.delete(expenseId)
      return next
    })
    setLastPendingId((cur) => (cur === expenseId ? null : cur))
  }

  return (
    <div>
      {readOnly && (
        <p className="mb-3 flex items-center gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
          <LockIcon className="h-3.5 w-3.5 shrink-0" />
          {t('expenses.readOnlyHint')}
        </p>
      )}

      {!readOnly && (
        <div className="mb-4 flex justify-end">
          <button
            onClick={() => setShowNew(true)}
            className="rounded-full bg-gradient-to-br from-[var(--color-brand-500)] to-[var(--color-brand-600)] px-4 py-2.5 font-medium text-white shadow-[0_10px_22px_-10px_var(--color-glow)]"
          >
            {t('expenses.new')}
          </button>
        </div>
      )}

      {/* Total gastado en la lista — a propósito separado y por encima del
          balance: son dos preguntas distintas ("¿cuánto llevamos gastado?"
          vs. "¿quién le debe a quién?") que antes solo se podían responder
          mirando el balance, que en realidad no contesta a la primera. */}
      {visibleExpenses.length > 0 && (
        <div className="glass-panel mb-4 flex items-baseline justify-between rounded-2xl px-4 py-3">
          <span className="text-sm font-medium text-slate-500 dark:text-slate-400">{t('expenses.totalSpent')}</span>
          <span className="text-lg font-bold text-slate-900 dark:text-slate-100">
            {formatCurrency(totalSpent, currency, language)}
          </span>
        </div>
      )}

      <BalanceSummary
        listId={listId}
        currency={currency}
        members={members}
        expenses={visibleExpenses}
        settlements={settlements}
      />

      {categoryTotals.length > 0 && (
        <div className="glass-panel mb-6 rounded-2xl p-4">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            {t('expenses.byCategory')}
          </h3>
          {/* Ahora se puede tocar una categoría para filtrar el histórico
              de abajo por ella (antes eran solo informativas, sin ninguna
              acción al tocarlas, lo cual no era lo esperable visualmente). */}
          <div className="flex flex-wrap gap-2">
            {categoryTotals.map((c) => (
              <button
                type="button"
                key={c.value}
                onClick={() => setCategoryFilter((cur) => (cur === c.value ? null : c.value))}
                className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                  categoryFilter === c.value
                    ? 'bg-gradient-to-br from-[var(--color-brand-500)] to-[var(--color-brand-600)] text-white shadow-[0_6px_14px_-8px_var(--color-glow)]'
                    : 'text-slate-600 bg-black/5 hover:bg-black/10 dark:text-slate-300 dark:bg-white/5 dark:hover:bg-white/10'
                }`}
              >
                {c.icon} {t(c.labelKey)}: {formatCurrency(c.total, currency, language)}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{t('expenses.historic')}</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">{t('expenses.historicSubtitle')}</p>
        </div>
        {categoryFilter && (
          <button
            onClick={() => setCategoryFilter(null)}
            className="flex shrink-0 items-center gap-1 text-xs font-medium text-brand-600 hover:underline dark:text-brand-400"
          >
            <CloseIcon className="h-3.5 w-3.5" />
            {t('expenses.clearCategoryFilter')}
          </button>
        )}
      </div>

      {ledger.length > SEARCH_THRESHOLD && (
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('expenses.searchPlaceholder')}
          aria-label={t('common.search')}
          className="mb-3 w-full rounded-full border px-3.5 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 border-[var(--color-glass-border)] bg-[var(--color-glass)] dark:text-slate-100"
        />
      )}

      {filteredLedger.length === 0 ? (
        categoryFilter ? (
          <p className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">{t('expenses.emptyCategoryFilter')}</p>
        ) : search.trim() ? (
          <p className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">{t('expenses.emptySearch')}</p>
        ) : (
          <div className="py-8 text-center">
            <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">{t('expenses.empty')}</p>
            {!readOnly && (
              <button
                onClick={() => setShowNew(true)}
                className="rounded-full bg-gradient-to-br from-[var(--color-brand-500)] to-[var(--color-brand-600)] px-4 py-2 text-sm font-medium text-white shadow-[0_10px_22px_-10px_var(--color-glow)]"
              >
                {t('expenses.addFirst')}
              </button>
            )}
          </div>
        )
      ) : (
        <div className="space-y-2">
          {filteredLedger.map((row) =>
            row.kind === 'expense' ? (
              <div
                key={`e-${row.data.id}`}
                className={`glass-panel overflow-hidden rounded-2xl ${
                  row.data.is_draft ? '!border-amber-300 dark:!border-amber-700' : ''
                }`}
              >
                <div className="flex w-full items-center justify-between px-4 py-3">
                  <button onClick={() => toggleExpand(row.data)} className="flex flex-1 items-center gap-2 text-left">
                    {row.data.no_debt ? (
                      <span
                        className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-300"
                        aria-hidden="true"
                      >
                        <HandshakeIcon className="h-4 w-4" />
                      </span>
                    ) : (
                      <Avatar username={row.data.payer?.username ?? '?'} avatarUrl={row.data.payer?.avatar_url} size={30} />
                    )}
                    <div>
                      <p className="text-sm font-medium text-slate-800 dark:text-slate-100">
                        <span className="mr-1">{categoryIcon(row.data.category)}</span>
                        {row.data.description || t('expenses.ticket')}
                        {row.data.no_debt
                          ? ` · ${t('expenses.noDebtBadge')}`
                          : !soloList
                            ? ` · ${t('expenses.paidBy', { name: row.data.payer?.username ?? '—' })}`
                            : ''}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {new Date(row.data.created_at).toLocaleString(language === 'en' ? 'en-US' : 'es-ES')}
                        {row.data.is_draft && (
                          <span className="ml-2 font-medium text-amber-600 dark:text-amber-400">{t('expenses.draftBadge')}</span>
                        )}
                      </p>
                    </div>
                  </button>
                  <div className="flex items-center gap-1">
                    <span className="font-semibold text-slate-800 dark:text-slate-100">{formatCurrency(row.data.total_amount, currency, language)}</span>
                    {row.data.created_by === user?.id && (
                      <>
                        {!readOnly && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              setEditingExpense(row.data)
                            }}
                            className="rounded-lg p-1.5 text-slate-500 dark:text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-200"
                            aria-label={t('expenses.edit')}
                            title={t('expenses.edit')}
                          >
                            <EditIcon className="h-4 w-4" />
                          </button>
                        )}
                        <button
                          onClick={(e) => requestDelete(e, row.data.id)}
                          className="rounded-lg p-1.5 text-slate-500 dark:text-slate-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/40"
                          aria-label={t('expenses.delete')}
                          title={t('expenses.delete')}
                        >
                          <TrashIcon className="h-4 w-4" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
                {expandedId === row.data.id && (
                  <div className="border-t px-4 py-3 border-[var(--color-glass-border)]">
                    {row.data.receipt_image_path && (
                      <div className="mb-3">
                        {receiptUrl ? (
                          <img src={receiptUrl} alt={t('expenses.ticket')} className="max-h-64 rounded-lg object-contain" />
                        ) : (
                          <p className="text-xs text-slate-500 dark:text-slate-400">{t('expenses.loadingImage')}</p>
                        )}
                      </div>
                    )}
                    {row.data.file_path && (
                      // Sin visor embebido, igual que en el chat: tocarlo lo
                      // abre en una pestaña nueva con el visor del propio
                      // navegador/teléfono.
                      <a
                        href={attachmentUrl ?? undefined}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => {
                          e.stopPropagation()
                          if (!attachmentUrl) e.preventDefault()
                        }}
                        className={`mb-3 flex items-center gap-2.5 rounded-lg bg-black/5 px-2.5 py-2 dark:bg-white/5 ${
                          attachmentUrl ? 'cursor-pointer' : 'cursor-default opacity-70'
                        }`}
                      >
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--color-glass)] text-[var(--color-brand-600)]">
                          <FileAttachmentIcon className="h-4 w-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                            {row.data.file_name ?? t('chat.replyFile')}
                          </span>
                          {row.data.file_size_bytes != null && (
                            <span className="text-xs text-slate-500 dark:text-slate-400">
                              {formatFileSize(row.data.file_size_bytes)}
                            </span>
                          )}
                        </span>
                      </a>
                    )}
                    <p className="mb-1 text-xs font-medium text-slate-500 dark:text-slate-400">{t('expenses.breakdown')}</p>
                    <div className="space-y-1">
                      {(row.data.shares ?? []).map((s) => (
                        <div key={s.id} className="flex justify-between text-sm text-slate-600 dark:text-slate-300">
                          <span>{s.profile?.username ?? s.user_id}</span>
                          <span>{formatCurrency(s.amount, currency, language)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              // Solo llegan aquí liquidaciones YA confirmadas (ver el
              // filtro al construir "ledger" más arriba) — la que está
              // pendiente de confirmar se ve, con sus propios botones, en
              // el aviso de arriba (BalanceSummary), no aquí.
              <div
                key={`s-${row.data.id}`}
                className="flex items-center justify-between rounded-2xl bg-green-50 px-4 py-3 ring-1 ring-green-100 dark:bg-green-950/30 dark:ring-green-900"
              >
                <div>
                  <p className="flex items-center gap-1.5 text-sm text-green-800 dark:text-green-400">
                    <CheckIcon className="h-4 w-4 shrink-0" />
                    {t('expenses.settledMessage', {
                      from: row.data.from_profile?.username ?? '—',
                      to: row.data.to_profile?.username ?? '—',
                    })}
                    {row.data.note ? ` · ${row.data.note}` : ''}
                  </p>
                  <p className="text-xs text-green-600 dark:text-green-500">
                    {new Date(row.data.created_at).toLocaleString(language === 'en' ? 'en-US' : 'es-ES')}
                  </p>
                </div>
                <span className="font-semibold text-green-800 dark:text-green-400">{formatCurrency(row.data.amount, currency, language)}</span>
              </div>
            ),
          )}
        </div>
      )}

      {showNew && (
        <NewExpenseModal
          listId={listId}
          currency={currency}
          members={members}
          onClose={() => setShowNew(false)}
          onCreated={() => setShowNew(false)}
        />
      )}

      {editingExpense && (
        <NewExpenseModal
          listId={listId}
          currency={currency}
          members={members}
          editing={editingExpense}
          onClose={() => setEditingExpense(null)}
          onCreated={() => setEditingExpense(null)}
        />
      )}

      {lastPendingId && <UndoToast message={t('expenses.deleted')} onUndo={() => undoDelete(lastPendingId)} />}
    </div>
  )
}
