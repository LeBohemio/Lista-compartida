import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../lib/i18n'
import { formatCurrency } from '../lib/balances'
import type { CurrencyCode } from '../lib/currencies'
import Avatar from './Avatar'
import { CloseIcon } from './icons'
import type { Profile } from '../lib/types'

type ExpenseRow = { total_amount: number; created_at: string }
type SettlementRow = { amount: number; created_at: string; from_user: string | null; to_user: string | null }

function monthStart(dateStr: string) {
  const d = new Date(dateStr)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

// Paso por el que se pasa al pulsar "eliminar" o "salir" de una lista (ver
// ListsPage.tsx). Sustituye al antiguo ConfirmDialog de una sola pregunta:
// ahora, según el caso, puede hacer falta elegir a quién se le cede el
// mando (si hay más gente) y/o decidir qué pasa con tus propios gastos de
// esa lista en tu "Mis gastos" — pero SIEMPRE termina con una confirmación
// explícita antes de tocar nada, igual que antes.
export default function LeaveListModal({
  listId,
  listName,
  listColor,
  currency,
  isOwner,
  otherMembers,
  onClose,
  onDone,
}: {
  listId: string
  listName: string
  listColor: string | null
  currency: CurrencyCode
  isOwner: boolean
  // Miembros ACEPTADOS de la lista, sin contarte a ti — candidatos a nuevo
  // administrador si eres el dueño y hay más gente. Ver memberAvatars en
  // useLists.ts.
  otherMembers: Profile[]
  onClose: () => void
  onDone: () => void
}) {
  const { user, profile } = useAuth()
  const { t, language } = useLanguage()

  // 'loading': todavía comprobando si tienes gastos propios en esta lista.
  // 'confirm': la pregunta clásica de siempre ("¿seguro que quieres
  // eliminar/salir?") — solo para cuando NO hace falta ceder el mando
  // (lista tuya en solitario, o simplemente saliendo sin ser dueño).
  // 'pick-admin': eliges quién se queda al mando (dueño + más gente) — esta
  // pantalla hace ya de confirmación para ese caso, no hace falta una
  // 'confirm' aparte.
  // 'accounting' / 'drop-confirm': qué hacer con tus propios gastos de esta
  // lista — solo aparece si de verdad has registrado algo.
  // 'working': ejecutando, sin botones.
  const [step, setStep] = useState<
    'loading' | 'confirm' | 'pick-admin' | 'accounting' | 'drop-confirm' | 'working'
  >('loading')
  const [selectedAdmin, setSelectedAdmin] = useState<string | null>(null)
  const [netTotal, setNetTotal] = useState(0)
  const [monthlyForCarryover, setMonthlyForCarryover] = useState<
    Map<string, { paidDirectly: number; paidToSettle: number; collected: number }>
  >(new Map())
  const [error, setError] = useState<string | null>(null)

  const needsAdminPick = isOwner && otherMembers.length > 0
  const isRealDelete = isOwner && otherMembers.length === 0

  // Al abrir, comprobamos si tienes algo propio registrado en esta lista
  // (gastos que pagaste tú, liquidaciones tuyas ya confirmadas) — si no hay
  // nada, nos saltamos el paso de "qué hacer con tus gastos" directamente,
  // no tiene sentido preguntar por un número que es cero.
  useEffect(() => {
    if (!user) return
    let cancelled = false
    const cutoff = profile?.expenses_reset_at ?? null

    const run = async () => {
      let expensesQuery = supabase
        .from('expenses')
        .select('total_amount, created_at')
        .eq('list_id', listId)
        .eq('paid_by', user.id)
      let settlementsQuery = supabase
        .from('settlements')
        .select('amount, created_at, from_user, to_user')
        .eq('list_id', listId)
        .or(`from_user.eq.${user.id},to_user.eq.${user.id}`)
        .not('confirmed_at', 'is', null)
      if (cutoff) {
        expensesQuery = expensesQuery.gte('created_at', cutoff)
        settlementsQuery = settlementsQuery.gte('created_at', cutoff)
      }

      const [expRes, settRes] = await Promise.all([expensesQuery, settlementsQuery])
      if (cancelled) return

      const expenses = (expRes.data as unknown as ExpenseRow[]) ?? []
      const settlements = (settRes.data as unknown as SettlementRow[]) ?? []

      const byMonth = new Map<string, { paidDirectly: number; paidToSettle: number; collected: number }>()
      const bump = (key: string, field: 'paidDirectly' | 'paidToSettle' | 'collected', amount: number) => {
        const cur = byMonth.get(key) ?? { paidDirectly: 0, paidToSettle: 0, collected: 0 }
        cur[field] += amount
        byMonth.set(key, cur)
      }
      let total = 0
      for (const e of expenses) {
        bump(monthStart(e.created_at), 'paidDirectly', Number(e.total_amount))
        total += Number(e.total_amount)
      }
      for (const s of settlements) {
        if (s.from_user === user.id) {
          bump(monthStart(s.created_at), 'paidToSettle', Number(s.amount))
          total += Number(s.amount)
        } else if (s.to_user === user.id) {
          bump(monthStart(s.created_at), 'collected', Number(s.amount))
          total -= Number(s.amount)
        }
      }

      setMonthlyForCarryover(byMonth)
      setNetTotal(total)
      setStep(needsAdminPick ? 'pick-admin' : 'confirm')
    }

    run()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, listId, profile?.expenses_reset_at])

  const hasOwnActivity = monthlyForCarryover.size > 0

  const goToAccountingOrFinish = () => {
    if (hasOwnActivity) setStep('accounting')
    else void finalize(null)
  }

  const finalize = async (choice: 'keep' | 'drop' | null) => {
    if (!user) return
    setStep('working')
    setError(null)
    try {
      if (choice === 'drop') {
        const { error: exclErr } = await supabase
          .from('personal_expense_exclusions')
          .upsert({ user_id: user.id, list_id: listId }, { onConflict: 'user_id,list_id' })
        if (exclErr) throw exclErr
      } else if (choice === 'keep' && isRealDelete) {
        // Solo hace falta guardar un resumen si la lista va a desaparecer
        // de verdad (nadie más dentro) — si sigue existiendo para otra
        // gente, tus gastos siguen ahí tal cual, sin que haga falta copiar
        // nada a ningún otro sitio.
        const rows = Array.from(monthlyForCarryover.entries()).map(([period_start, v]) => ({
          user_id: user.id,
          list_name: listName,
          list_color: listColor,
          currency,
          period_start,
          paid_directly: v.paidDirectly,
          paid_to_settle: v.paidToSettle,
          collected: v.collected,
        }))
        if (rows.length > 0) {
          const { error: carryErr } = await supabase.from('personal_expense_carryover').insert(rows)
          if (carryErr) throw carryErr
        }
      }

      if (needsAdminPick && selectedAdmin) {
        const { error: rpcErr } = await supabase.rpc('transfer_list_ownership_and_leave', {
          p_list_id: listId,
          p_new_owner: selectedAdmin,
        })
        if (rpcErr) throw rpcErr
      } else if (isOwner) {
        const { error: delErr } = await supabase.from('lists').delete().eq('id', listId)
        if (delErr) throw delErr
      } else {
        const { error: leaveErr } = await supabase
          .from('list_members')
          .delete()
          .eq('list_id', listId)
          .eq('user_id', user.id)
        if (leaveErr) throw leaveErr
      }

      onDone()
      onClose()
    } catch {
      setError(t('leaveList.errorGeneric'))
      setStep(hasOwnActivity ? 'accounting' : needsAdminPick ? 'pick-admin' : 'confirm')
    }
  }

  const title =
    step === 'pick-admin'
      ? t('leaveList.pickAdminTitle')
      : step === 'accounting' || step === 'drop-confirm'
        ? t('leaveList.accountingTitle', { name: listName })
        : isOwner
          ? t('list.deleteTitle')
          : t('list.leaveTitle')

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div
        className="glass-panel relative w-full max-w-sm rounded-t-[28px] p-6 shadow-[0_24px_60px_-20px_rgba(20,21,26,0.5)] sm:rounded-[28px]"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          aria-label={t('common.close')}
          className="absolute right-4 top-4 rounded-full p-1.5 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700"
        >
          <CloseIcon className="h-4 w-4" />
        </button>

        <h2 className="mb-2 pr-8 text-lg font-semibold text-slate-900 dark:text-slate-100">{title}</h2>

        {step === 'loading' && (
          <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">{t('common.loading')}</p>
        )}

        {step === 'confirm' && (
          <>
            <p className="mb-5 text-sm text-slate-600 dark:text-slate-300">
              {isOwner ? t('dialogs.deleteMessage', { name: listName }) : t('list.leaveConfirm', { name: listName })}
            </p>
            {error && <p className="mb-3 text-sm text-red-500">{error}</p>}
            <div className="flex gap-3">
              <button
                onClick={onClose}
                className="flex-1 rounded-full border px-4 py-2.5 font-medium text-slate-700 hover:bg-white/60 border-[var(--color-glass-border)] dark:text-slate-200 dark:hover:bg-white/10"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={goToAccountingOrFinish}
                className="flex-1 rounded-full bg-gradient-to-br from-red-500 to-red-600 px-4 py-2.5 font-medium text-white shadow-[0_10px_22px_-10px_rgba(220,38,38,0.5)]"
              >
                {isOwner ? t('menu.delete') : t('list.leaveButton')}
              </button>
            </div>
          </>
        )}

        {step === 'pick-admin' && (
          <>
            <p className="mb-4 text-sm text-slate-600 dark:text-slate-300">
              {t('leaveList.pickAdminBody', { name: listName })}
            </p>
            <div className="mb-5 max-h-64 space-y-2 overflow-y-auto">
              {otherMembers.map((m) => (
                <button
                  key={m.id}
                  onClick={() => setSelectedAdmin(m.id)}
                  className={`flex w-full items-center gap-3 rounded-2xl border px-3 py-2.5 text-left text-sm transition ${
                    selectedAdmin === m.id
                      ? 'border-[var(--color-brand-500)] bg-[var(--color-brand-50)] dark:bg-[var(--color-brand-950)]/40'
                      : 'border-[var(--color-glass-border)] hover:bg-white/40 dark:hover:bg-white/5'
                  }`}
                >
                  <Avatar username={m.username} avatarUrl={m.avatar_url} size={32} enlargeOnClick={false} />
                  <span className="font-medium text-slate-800 dark:text-slate-100">{m.username}</span>
                </button>
              ))}
            </div>
            {error && <p className="mb-3 text-sm text-red-500">{error}</p>}
            <div className="flex gap-3">
              <button
                onClick={onClose}
                className="flex-1 rounded-full border px-4 py-2.5 font-medium text-slate-700 hover:bg-white/60 border-[var(--color-glass-border)] dark:text-slate-200 dark:hover:bg-white/10"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={goToAccountingOrFinish}
                disabled={!selectedAdmin}
                className="flex-1 rounded-full bg-gradient-to-br from-[var(--color-brand-500)] to-[var(--color-brand-600)] px-4 py-2.5 font-medium text-white shadow-[0_10px_22px_-10px_var(--color-glow)] disabled:opacity-50"
              >
                {t('leaveList.continue')}
              </button>
            </div>
          </>
        )}

        {step === 'accounting' && (
          <>
            <p className="mb-2 text-sm text-slate-600 dark:text-slate-300">
              {isRealDelete ? t('leaveList.accountingBodyDelete') : t('leaveList.accountingBodyStay')}
            </p>
            <p className="mb-5 text-2xl font-semibold text-slate-900 dark:text-slate-100">
              {formatCurrency(netTotal, currency, language)}
            </p>
            {error && <p className="mb-3 text-sm text-red-500">{error}</p>}
            <div className="flex flex-col gap-2.5">
              <button
                onClick={() => void finalize('keep')}
                className="w-full rounded-full bg-gradient-to-br from-[var(--color-brand-500)] to-[var(--color-brand-600)] px-4 py-2.5 font-medium text-white shadow-[0_10px_22px_-10px_var(--color-glow)]"
              >
                {t('leaveList.keepExpenses')}
              </button>
              <button
                onClick={() => setStep('drop-confirm')}
                className="w-full rounded-full border px-4 py-2.5 font-medium text-slate-700 hover:bg-white/60 border-[var(--color-glass-border)] dark:text-slate-200 dark:hover:bg-white/10"
              >
                {t('leaveList.dropExpenses')}
              </button>
            </div>
          </>
        )}

        {step === 'drop-confirm' && (
          <>
            <p className="mb-5 text-sm text-slate-600 dark:text-slate-300">{t('leaveList.dropConfirmMessage')}</p>
            {error && <p className="mb-3 text-sm text-red-500">{error}</p>}
            <div className="flex gap-3">
              <button
                onClick={() => setStep('accounting')}
                className="flex-1 rounded-full border px-4 py-2.5 font-medium text-slate-700 hover:bg-white/60 border-[var(--color-glass-border)] dark:text-slate-200 dark:hover:bg-white/10"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={() => void finalize('drop')}
                className="flex-1 rounded-full bg-gradient-to-br from-red-500 to-red-600 px-4 py-2.5 font-medium text-white shadow-[0_10px_22px_-10px_rgba(220,38,38,0.5)]"
              >
                {t('leaveList.dropConfirmButton')}
              </button>
            </div>
          </>
        )}

        {step === 'working' && (
          <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">{t('common.saving')}</p>
        )}
      </div>
    </div>,
    document.body,
  )
}
