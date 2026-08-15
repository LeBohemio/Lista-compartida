import { useMemo, useState } from 'react'
import { computeNetBalances, formatEuro, simplifyDebts } from '../lib/balances'
import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../lib/i18n'
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
  const { t } = useLanguage()
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
    const lines: string[] = [t('balance.shareHeader'), '']
    for (const m of accepted) {
      const balance = netBalances[m.user_id] ?? 0
      const name = m.profile?.username ?? m.user_id
      const status =
        balance > 0.004
          ? t('balance.owed', { amount: formatEuro(balance) })
          : balance < -0.004
            ? t('balance.owes', { amount: formatEuro(-balance) })
            : t('balance.settled')
      lines.push(`• ${name}: ${status}`)
    }
    if (suggestedDebts.length > 0) {
      lines.push('', t('balance.pendingPayments'))
      for (const d of suggestedDebts) {
        lines.push(`• ${profileById.get(d.from)} ${t('balance.owesAmountTo', { amount: formatEuro(d.amount) })} ${profileById.get(d.to)}`)
      }
    } else {
      lines.push('', t('balance.noDebts'))
    }
    return lines.join('\n')
  }

  const shareBalance = async () => {
    const text = buildShareText()
    if (navigator.share) {
      try {
        await navigator.share({ title: t('balance.shareTitle'), text })
      } catch {
        // el usuario canceló el share sheet, no hacemos nada
      }
      return
    }
    try {
      await navigator.clipboard.writeText(text)
      setShareFeedback(t('chat.copied'))
      setTimeout(() => setShareFeedback(null), 2500)
    } catch {
      setShareFeedback(t('balance.errorCopy'))
      setTimeout(() => setShareFeedback(null), 2500)
    }
  }

  return (
    <div className="mb-6 rounded-xl p-4 shadow-sm ring-1 bg-[var(--color-surface)] ring-[var(--color-surface-border)]">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Balance</h3>
        <button
          onClick={shareBalance}
          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-200"
          aria-label={t('balance.share')}
          title={t('balance.share')}
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
                {isMe ? ` ${t('expenses.you')}` : ''}
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
                {balance > 0.004
                  ? t('balance.owed', { amount: formatEuro(balance) })
                  : balance < -0.004
                    ? t('balance.owes', { amount: formatEuro(-balance) })
                    : t('balance.settled')}
              </span>
            </div>
          )
        })}
      </div>

      {suggestedDebts.length === 0 ? (
        <p className="text-sm text-slate-400">{t('balance.noDebts')}</p>
      ) : (
        <div className="space-y-2 border-t border-slate-100 pt-3 border-[var(--color-surface-border)]">
          {suggestedDebts.map((d, idx) => {
            const canSettle = user?.id === d.from || user?.id === d.to
            return (
              <div key={idx} className="flex items-center justify-between text-sm">
                <span className="text-slate-700 dark:text-slate-200">
                  <strong className="text-red-500 dark:text-red-400">{profileById.get(d.from)}</strong>{' '}
                  {t('balance.owesAmountTo', { amount: formatEuro(d.amount) })}{' '}
                  <strong className="text-green-600 dark:text-green-400">{profileById.get(d.to)}</strong>
                </span>
                {canSettle && (
                  <button
                    onClick={() => setSettling(d)}
                    className="rounded-lg border border-brand-300 px-2.5 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50 dark:border-brand-700 dark:text-brand-400 dark:hover:bg-brand-950/40"
                  >
                    {t('balance.markSettled')}
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
