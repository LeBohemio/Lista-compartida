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
  const [shareFeedback, setShareFeedback] = useState<string | null>(null)

  const profileById = useMemo(() => {
    const map = new Map<string, string>()
    for (const m of members) map.set(m.user_id, m.profile?.username ?? '—')
    return map
  }, [members])

  const netBalances = useMemo(() => computeNetBalances(expenses, settlements), [expenses, settlements])
  const suggestedDebts = useMemo(() => simplifyDebts(netBalances), [netBalances])

  const accepted = members.filter((m) => m.status === 'accepted')

  const buildShareText = () => {
    const lines: string[] = ['📋 Balance de la lista', '']
    for (const m of accepted) {
      const balance = netBalances[m.user_id] ?? 0
      const name = m.profile?.username ?? m.user_id
      const status =
        balance > 0.004 ? `le deben ${formatEuro(balance)}` : balance < -0.004 ? `debe ${formatEuro(-balance)}` : 'al día'
      lines.push(`• ${name}: ${status}`)
    }
    if (suggestedDebts.length > 0) {
      lines.push('', 'Pagos pendientes:')
      for (const d of suggestedDebts) {
        lines.push(`• ${profileById.get(d.from)} debe ${formatEuro(d.amount)} a ${profileById.get(d.to)}`)
      }
    } else {
      lines.push('', 'No hay deudas pendientes.')
    }
    return lines.join('\n')
  }

  const shareBalance = async () => {
    const text = buildShareText()
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Balance de la lista', text })
      } catch {
        // el usuario canceló el share sheet, no hacemos nada
      }
      return
    }
    try {
      await navigator.clipboard.writeText(text)
      setShareFeedback('Copiado al portapapeles')
      setTimeout(() => setShareFeedback(null), 2500)
    } catch {
      setShareFeedback('No se pudo copiar el balance')
      setTimeout(() => setShareFeedback(null), 2500)
    }
  }

  return (
    <div className="mb-6 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200 dark:bg-slate-800 dark:ring-slate-700">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Balance</h3>
        <button
          onClick={shareBalance}
          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-200"
          aria-label="Compartir balance"
          title="Compartir balance"
        >
          📤
        </button>
      </div>

      {shareFeedback && (
        <p className="mb-3 rounded-lg bg-slate-100 px-3 py-1.5 text-xs text-slate-600 dark:bg-slate-700 dark:text-slate-300">
          {shareFeedback}
        </p>
      )}

      <div className="mb-4 space-y-1.5">
        {accepted.map((m) => {
          const balance = netBalances[m.user_id] ?? 0
          const isMe = m.user_id === user?.id
          return (
            <div key={m.user_id} className="flex items-center justify-between text-sm">
              <span className="text-slate-700 dark:text-slate-200">
                {m.profile?.username ?? m.user_id}
                {isMe ? ' (tú)' : ''}
              </span>
              <span
                className={`font-medium ${
                  balance > 0.004
                    ? 'text-green-600 dark:text-green-400'
                    : balance < -0.004
                      ? 'text-red-500 dark:text-red-400'
                      : 'text-slate-400'
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
        <div className="space-y-2 border-t border-slate-100 pt-3 dark:border-slate-700">
          {suggestedDebts.map((d, idx) => {
            const canSettle = user?.id === d.from || user?.id === d.to
            return (
              <div key={idx} className="flex items-center justify-between text-sm">
                <span className="text-slate-700 dark:text-slate-200">
                  <strong className="text-red-500 dark:text-red-400">{profileById.get(d.from)}</strong> debe {formatEuro(d.amount)} a{' '}
                  <strong className="text-green-600 dark:text-green-400">{profileById.get(d.to)}</strong>
                </span>
                {canSettle && (
                  <button
                    onClick={() => setSettling(d)}
                    className="rounded-lg border border-brand-300 px-2.5 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50 dark:border-brand-700 dark:text-brand-400 dark:hover:bg-brand-950/40"
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
