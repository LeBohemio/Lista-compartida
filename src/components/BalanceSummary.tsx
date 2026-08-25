import { useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { computeNetBalances, formatCurrency, simplifyDebts } from '../lib/balances'
import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../lib/i18n'
import { useToast } from '../context/ToastContext'
import type { CurrencyCode } from '../lib/currencies'
import type { Expense, ListMember, Settlement, SuggestedDebt } from '../lib/types'
import SettleUpModal from './SettleUpModal'
import { ShareIcon } from './icons'

export default function BalanceSummary({
  listId,
  currency,
  members,
  expenses,
  settlements,
}: {
  listId: string
  currency: CurrencyCode
  members: ListMember[]
  expenses: Expense[]
  settlements: Settlement[]
}) {
  const { user } = useAuth()
  const { t, language } = useLanguage()
  const { showError } = useToast()
  const [settling, setSettling] = useState<SuggestedDebt | null>(null)
  const [shareFeedback, setShareFeedback] = useState<string | null>(null)
  const [actingOnId, setActingOnId] = useState<string | null>(null)

  const pendingSettlements = useMemo(
    () => settlements.filter((s) => !s.confirmed_at && (s.from_user === user?.id || s.to_user === user?.id)),
    [settlements, user],
  )

  const confirmSettlement = async (id: string) => {
    setActingOnId(id)
    const { error: err } = await supabase.from('settlements').update({ confirmed_at: new Date().toISOString() }).eq('id', id)
    if (err) showError(t('common.saveError'))
    setActingOnId(null)
  }

  const removeSettlement = async (id: string) => {
    setActingOnId(id)
    const { error: err } = await supabase.from('settlements').delete().eq('id', id)
    if (err) showError(t('common.deleteError'))
    setActingOnId(null)
  }

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
          ? t('balance.owed', { amount: formatCurrency(balance, currency, language) })
          : balance < -0.004
            ? t('balance.owes', { amount: formatCurrency(-balance, currency, language) })
            : t('balance.settled')
      lines.push(`• ${name}: ${status}`)
    }
    if (suggestedDebts.length > 0) {
      lines.push('', t('balance.pendingPayments'))
      for (const d of suggestedDebts) {
        lines.push(`• ${profileById.get(d.from)} ${t('balance.owesAmountTo', { amount: formatCurrency(d.amount, currency, language) })} ${profileById.get(d.to)}`)
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
    <div className="glass-panel mb-6 rounded-2xl p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Balance</h3>
        <button
          onClick={shareBalance}
          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-200"
          aria-label={t('balance.share')}
          title={t('balance.share')}
        >
          <ShareIcon className="h-4 w-4" />
        </button>
      </div>

      {shareFeedback && (
        <p className="mb-3 rounded-lg bg-slate-100 px-3 py-1.5 text-xs text-slate-600 dark:bg-slate-700 dark:text-slate-300">
          {shareFeedback}
        </p>
      )}

      {pendingSettlements.length > 0 && (
        <div className="mb-4 space-y-2 rounded-lg bg-amber-50 p-3 dark:bg-amber-950/30">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
            ⏳ {t('settle.pendingSectionTitle')}
          </p>
          {pendingSettlements.map((s) => {
            const iAmOwed = s.to_user === user?.id
            const otherName = iAmOwed ? (profileById.get(s.from_user ?? '') ?? '—') : (profileById.get(s.to_user ?? '') ?? '—')
            const busy = actingOnId === s.id
            return (
              <div key={s.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="text-amber-800 dark:text-amber-300">
                  {iAmOwed
                    ? t('settle.claimToYou', { name: otherName, amount: formatCurrency(s.amount, currency, language) })
                    : t('settle.waitingOnOther', { name: otherName, amount: formatCurrency(s.amount, currency, language) })}
                </span>
                <div className="flex shrink-0 gap-1.5">
                  {iAmOwed && (
                    <button
                      disabled={busy}
                      onClick={() => confirmSettlement(s.id)}
                      className="rounded-lg bg-green-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-60"
                    >
                      {t('settle.confirmReceived')}
                    </button>
                  )}
                  <button
                    disabled={busy}
                    onClick={() => removeSettlement(s.id)}
                    className="rounded-lg border border-amber-300 px-2.5 py-1 text-xs font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-60 dark:border-amber-700 dark:text-amber-400 dark:hover:bg-amber-950/40"
                  >
                    {iAmOwed ? t('settle.reject') : t('settle.withdraw')}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
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
                  ? t('balance.owed', { amount: formatCurrency(balance, currency, language) })
                  : balance < -0.004
                    ? t('balance.owes', { amount: formatCurrency(-balance, currency, language) })
                    : t('balance.settled')}
              </span>
            </div>
          )
        })}
      </div>

      {suggestedDebts.length === 0 ? (
        <p className="text-sm text-slate-400">{t('balance.noDebts')}</p>
      ) : (
        <div className="space-y-2 border-t pt-3 border-[var(--color-glass-border)]">
          {suggestedDebts.map((d, idx) => {
            const canSettle = user?.id === d.from || user?.id === d.to
            return (
              <div key={idx} className="flex items-center justify-between text-sm">
                <span className="text-slate-700 dark:text-slate-200">
                  <strong className="text-red-500 dark:text-red-400">{profileById.get(d.from)}</strong>{' '}
                  {t('balance.owesAmountTo', { amount: formatCurrency(d.amount, currency, language) })}{' '}
                  <strong className="text-green-600 dark:text-green-400">{profileById.get(d.to)}</strong>
                </span>
                {canSettle && (
                  <button
                    onClick={() => setSettling(d)}
                    className="rounded-full bg-gradient-to-br from-[var(--color-brand-500)] to-[var(--color-brand-600)] px-2.5 py-1 text-xs font-medium text-white shadow-[0_6px_14px_-8px_var(--color-glow)]"
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
          currency={currency}
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
