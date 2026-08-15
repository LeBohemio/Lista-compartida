import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { formatEuro } from '../lib/balances'

type ListRef = { name: string; color: string | null }
type ExpenseRow = { id: string; list_id: string; total_amount: number; created_at: string; list: ListRef | null }
type SettlementRow = { id: string; amount: number; created_at: string }

function monthKey(dateStr: string) {
  const d = new Date(dateStr)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export default function MyExpensesModal({ onClose }: { onClose: () => void }) {
  const { user } = useAuth()
  const [expenses, setExpenses] = useState<ExpenseRow[]>([])
  const [settlements, setSettlements] = useState<SettlementRow[]>([])
  const [loading, setLoading] = useState(true)
  const [monthOffset, setMonthOffset] = useState(0)

  useEffect(() => {
    if (!user) return
    setLoading(true)
    Promise.all([
      supabase
        .from('expenses')
        .select('id, list_id, total_amount, created_at, list:lists(name, color)')
        .eq('paid_by', user.id)
        .order('created_at', { ascending: false }),
      supabase
        .from('settlements')
        .select('id, amount, created_at')
        .eq('to_user', user.id)
        .order('created_at', { ascending: false }),
    ]).then(([expRes, settRes]) => {
      setExpenses(((expRes.data as unknown as ExpenseRow[]) ?? []))
      setSettlements(((settRes.data as unknown as SettlementRow[]) ?? []))
      setLoading(false)
    })
  }, [user])

  const monthDate = useMemo(() => {
    const d = new Date()
    d.setDate(1)
    d.setMonth(d.getMonth() - monthOffset)
    return d
  }, [monthOffset])

  const key = `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, '0')}`
  const monthLabel = monthDate.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })

  const monthExpenses = expenses.filter((e) => monthKey(e.created_at) === key)
  const monthSettlements = settlements.filter((s) => monthKey(s.created_at) === key)

  const byList = useMemo(() => {
    const map = new Map<string, { name: string; color: string | null; total: number }>()
    for (const e of monthExpenses) {
      const cur = map.get(e.list_id) ?? { name: e.list?.name ?? '—', color: e.list?.color ?? null, total: 0 }
      cur.total += Number(e.total_amount)
      map.set(e.list_id, cur)
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, expenses])

  const totalMonth = monthExpenses.reduce((sum, e) => sum + Number(e.total_amount), 0)
  const totalCollected = monthSettlements.reduce((sum, s) => sum + Number(s.amount), 0)

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div
        className="relative max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-6 shadow-xl sm:rounded-2xl dark:bg-[var(--color-surface)]"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          aria-label="Cerrar"
          title="Cerrar"
          className="absolute right-4 top-4 rounded-full p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-200"
        >
          ✕
        </button>
        <h2 className="mb-4 pr-8 text-lg font-semibold text-slate-900 dark:text-slate-100">Mis gastos</h2>

        <div className="mb-5 flex items-center justify-between">
          <button
            onClick={() => setMonthOffset((o) => o + 1)}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-200"
            aria-label="Mes anterior"
          >
            ‹
          </button>
          <p className="text-sm font-medium capitalize text-slate-700 dark:text-slate-200">{monthLabel}</p>
          <button
            onClick={() => setMonthOffset((o) => Math.max(0, o - 1))}
            disabled={monthOffset === 0}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-30 dark:hover:bg-slate-700 dark:hover:text-slate-200"
            aria-label="Mes siguiente"
          >
            ›
          </button>
        </div>

        {loading ? (
          <p className="py-8 text-center text-sm text-slate-400">Cargando…</p>
        ) : byList.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-400">No pagaste ningún gasto compartido este mes.</p>
        ) : (
          <>
            <div className="mb-5 space-y-3">
              {byList.map((row) => {
                const pct = byList[0].total > 0 ? Math.max(4, Math.round((row.total / byList[0].total) * 100)) : 0
                return (
                  <div key={row.name}>
                    <div className="mb-1 flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2 text-slate-700 dark:text-slate-200">
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: row.color ?? '#94a3b8' }}
                          aria-hidden="true"
                        />
                        {row.name}
                      </span>
                      <span className="font-medium text-slate-800 dark:text-slate-100">{formatEuro(row.total)}</span>
                    </div>
                    <div className="h-2.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${pct}%`, backgroundColor: row.color ?? '#94a3b8' }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="flex items-center justify-between border-t border-slate-100 pt-3 text-sm font-semibold text-slate-900 dark:border-[var(--color-surface-border)] dark:text-slate-100">
              <span>Total</span>
              <span>{formatEuro(totalMonth)}</span>
            </div>

            {totalCollected > 0 && (
              <div className="mt-2 flex items-center justify-between text-sm text-green-600 dark:text-green-400">
                <span>Cobrado</span>
                <span className="font-medium">{formatEuro(totalCollected)}</span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
