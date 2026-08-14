import { useMemo, useState } from 'react'
import { computeNetBalances, formatEuro, simplifyDebts } from '../lib/balances'
import { useAuth } from '../context/AuthContext'
import type { Expense, ListMember, Settlement, SuggestedDebt } from '../lib/types'
import SettleUpModal from './SettleUpModal'

export default function BalanceSummary({
  listId,
  members,
  expenses,
  settlements,
}: {
  listId: string
  members: ListMember[]
  expenses: Expense[]
  settlements: Settlement[]
}) {
  const { user } = useAuth()
  const [settling, setSettling] = useState<SuggestedDebt | null>(null)

  const profileById = useMemo(() => {
    const map = new Map<string, string>()
    for (const m of members) map.set(m.user_id, m.profile?.username ?? '—')
    return map
  }, [members])

  const netBalances = useMemo(() => computeNetBalances(expenses, settlements), [expenses, settlements])
  const suggestedDebts = useMemo(() => simplifyDebts(netBalances), [netBalances])

  const accepted = members.filter((m) => m.status === 'accepted')

  return (
    <div className="mb-6 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Balance</h3>

      <div className="mb-4 space-y-1.5">
        {accepted.map((m) => {
          const balance = netBalances[m.user_id] ?? 0
          const isMe = m.user_id === user?.id
          return (
            <div key={m.user_id} className="flex items-center justify-between text-sm">
              <span className="text-slate-700">
                {m.profile?.username ?? m.user_id}
                {isMe ? ' (tú)' : ''}
              </span>
              <span
                className={`font-medium ${
                  balance > 0.004 ? 'text-green-600' : balance < -0.004 ? 'text-red-500' : 'text-slate-400'
                }`}
              >
                {balance > 0.004 ? `le deben ${formatEuro(balance)}` : balance < -0.004 ? `debe ${formatEuro(-balance)}` : 'al día'}
              </span>
            </div>
          )
        })}
      </div>

      {suggestedDebts.length === 0 ? (
        <p className="text-sm text-slate-400">No hay deudas pendientes.</p>
      ) : (
        <div className="space-y-2 border-t border-slate-100 pt-3">
          {suggestedDebts.map((d, idx) => {
            const canSettle = user?.id === d.from || user?.id === d.to
            return (
              <div key={idx} className="flex items-center justify-between text-sm">
                <span className="text-slate-700">
                  <strong className="text-red-500">{profileById.get(d.from)}</strong> debe {formatEuro(d.amount)} a{' '}
                  <strong className="text-green-600">{profileById.get(d.to)}</strong>
                </span>
                {canSettle && (
                  <button
                    onClick={() => setSettling(d)}
                    className="rounded-lg border border-brand-300 px-2.5 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50"
                  >
                    Marcar saldada
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {settling && (
        <SettleUpModal
          listId={listId}
          debt={settling}
          fromName={profileById.get(settling.from) ?? ''}
          toName={profileById.get(settling.to) ?? ''}
          onClose={() => setSettling(null)}
          onSettled={() => setSettling(null)}
        />
      )}
    </div>
  )
}
