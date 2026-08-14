import { useRef, useState, type MouseEvent } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { formatEuro } from '../lib/balances'
import type { Expense, ListMember, Settlement } from '../lib/types'
import NewExpenseModal from './NewExpenseModal'
import BalanceSummary from './BalanceSummary'
import Avatar from './Avatar'
import UndoToast from './UndoToast'

const UNDO_DELAY_MS = 5000

type LedgerRow =
  | { kind: 'expense'; date: string; data: Expense }
  | { kind: 'settlement'; date: string; data: Settlement }

export default function ExpensesPanel({
  listId,
  members,
  expenses,
  settlements,
  soloList,
}: {
  listId: string
  members: ListMember[]
  expenses: Expense[]
  settlements: Settlement[]
  soloList: boolean
}) {
  const { user } = useAuth()
  const [showNew, setShowNew] = useState(false)
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [receiptUrl, setReceiptUrl] = useState<string | null>(null)

  const [pendingDeleteIds, setPendingDeleteIds] = useState<Set<string>>(new Set())
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const [lastPendingId, setLastPendingId] = useState<string | null>(null)

  const visibleExpenses = expenses.filter((e) => !pendingDeleteIds.has(e.id))

  const ledger: LedgerRow[] = [
    ...visibleExpenses.map((e) => ({ kind: 'expense' as const, date: e.created_at, data: e })),
    ...settlements.map((s) => ({ kind: 'settlement' as const, date: s.created_at, data: s })),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

  const toggleExpand = async (expense: Expense) => {
    if (expandedId === expense.id) {
      setExpandedId(null)
      setReceiptUrl(null)
      return
    }
    setExpandedId(expense.id)
    setReceiptUrl(null)
    if (expense.receipt_image_path) {
      const { data } = await supabase.storage.from('receipts').createSignedUrl(expense.receipt_image_path, 3600)
      setReceiptUrl(data?.signedUrl ?? null)
    }
  }

  const requestDelete = (e: MouseEvent, expenseId: string) => {
    e.stopPropagation()
    setPendingDeleteIds((prev) => new Set(prev).add(expenseId))
    setLastPendingId(expenseId)
    const timer = setTimeout(async () => {
      timersRef.current.delete(expenseId)
      await supabase.from('expenses').delete().eq('id', expenseId)
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
      <div className="mb-4 flex justify-end">
        <button
          onClick={() => setShowNew(true)}
          className="rounded-lg bg-brand-600 px-4 py-2.5 font-medium text-white hover:bg-brand-700"
        >
          + Nuevo gasto
        </button>
      </div>

      <BalanceSummary listId={listId} members={members} expenses={visibleExpenses} settlements={settlements} />

      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Histórico</h3>

      {ledger.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-400">Todavía no hay gastos registrados.</p>
      ) : (
        <div className="space-y-2">
          {ledger.map((row) =>
            row.kind === 'expense' ? (
              <div key={`e-${row.data.id}`} className="rounded-lg bg-white shadow-sm ring-1 ring-slate-200">
                <div className="flex w-full items-center justify-between px-4 py-3">
                  <button onClick={() => toggleExpand(row.data)} className="flex flex-1 items-center gap-2 text-left">
                    <Avatar username={row.data.payer?.username ?? '?'} avatarUrl={row.data.payer?.avatar_url} size={30} />
                    <div>
                      <p className="text-sm font-medium text-slate-800">
                        {row.data.description || 'Ticket'}
                        {!soloList ? ` · pagado por ${row.data.payer?.username ?? '—'}` : ''}
                      </p>
                      <p className="text-xs text-slate-400">
                        {new Date(row.data.created_at).toLocaleString('es-ES')}
                      </p>
                    </div>
                  </button>
                  <div className="flex items-center gap-1">
                    <span className="font-semibold text-slate-800">{formatEuro(row.data.total_amount)}</span>
                    {row.data.created_by === user?.id && (
                      <>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            setEditingExpense(row.data)
                          }}
                          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                          aria-label="Editar gasto"
                          title="Editar gasto"
                        >
                          ✎
                        </button>
                        <button
                          onClick={(e) => requestDelete(e, row.data.id)}
                          className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-500"
                          aria-label="Eliminar gasto"
                          title="Eliminar gasto"
                        >
                          🗑
                        </button>
                      </>
                    )}
                  </div>
                </div>
                {expandedId === row.data.id && (
                  <div className="border-t border-slate-100 px-4 py-3">
                    {row.data.receipt_image_path && (
                      <div className="mb-3">
                        {receiptUrl ? (
                          <img src={receiptUrl} alt="Ticket" className="max-h-64 rounded-lg object-contain" />
                        ) : (
                          <p className="text-xs text-slate-400">Cargando imagen…</p>
                        )}
                      </div>
                    )}
                    <p className="mb-1 text-xs font-medium text-slate-500">Reparto:</p>
                    <div className="space-y-1">
                      {(row.data.shares ?? []).map((s) => (
                        <div key={s.id} className="flex justify-between text-sm text-slate-600">
                          <span>{s.profile?.username ?? s.user_id}</span>
                          <span>{formatEuro(s.amount)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div
                key={`s-${row.data.id}`}
                className="flex items-center justify-between rounded-lg bg-green-50 px-4 py-3 ring-1 ring-green-100"
              >
                <div>
                  <p className="text-sm text-green-800">
                    ✓ {row.data.from_profile?.username ?? '—'} pagó a {row.data.to_profile?.username ?? '—'}
                    {row.data.note ? ` · ${row.data.note}` : ''}
                  </p>
                  <p className="text-xs text-green-600">{new Date(row.data.created_at).toLocaleString('es-ES')}</p>
                </div>
                <span className="font-semibold text-green-800">{formatEuro(row.data.amount)}</span>
              </div>
            ),
          )}
        </div>
      )}

      {showNew && (
        <NewExpenseModal
          listId={listId}
          members={members}
          onClose={() => setShowNew(false)}
          onCreated={() => setShowNew(false)}
        />
      )}

      {editingExpense && (
        <NewExpenseModal
          listId={listId}
          members={members}
          editing={editingExpense}
          onClose={() => setEditingExpense(null)}
          onCreated={() => setEditingExpense(null)}
        />
      )}

      {lastPendingId && <UndoToast message="Gasto eliminado" onUndo={() => undoDelete(lastPendingId)} />}
    </div>
  )
}
