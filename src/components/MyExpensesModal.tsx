import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { formatCurrency } from '../lib/balances'
import { DEFAULT_CURRENCY, type CurrencyCode } from '../lib/currencies'
import { useLanguage } from '../lib/i18n'
import { useToast } from '../context/ToastContext'
import ConfirmDialog from './ConfirmDialog'
import { CloseIcon } from './icons'

type ListRef = { name: string; color: string | null; currency: CurrencyCode }
type ExpenseRow = { id: string; list_id: string; total_amount: number; created_at: string; list: ListRef | null }
type SettlementRow = { id: string; amount: number; created_at: string }

function monthKey(dateStr: string) {
  const d = new Date(dateStr)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export default function MyExpensesModal({ onClose }: { onClose: () => void }) {
  const { user, profile, refreshProfile } = useAuth()
  const { t, language } = useLanguage()
  const { showError } = useToast()
  // El total agregado del mes (que puede sumar gastos de varias listas) se
  // muestra en tu divisa de perfil — no hay conversión real, así que si
  // mezclas listas con divisas distintas ese total es solo orientativo. Cada
  // fila "por lista" de abajo sí usa la divisa real de esa lista.
  const myCurrency = profile?.currency ?? DEFAULT_CURRENCY
  const [expenses, setExpenses] = useState<ExpenseRow[]>([])
  const [settlements, setSettlements] = useState<SettlementRow[]>([])
  // Liquidaciones que TÚ has pagado (a diferencia de "settlements", que son
  // las que te han pagado A TI) — antes no se pedían aquí, y por eso no
  // sumaban como gasto: pagar tu parte a alguien es tan "gasto tuyo" como
  // pagar directamente al anotarlo (ver comentario junto a "netTotal" más
  // abajo).
  const [settlementsPaid, setSettlementsPaid] = useState<SettlementRow[]>([])
  const [loading, setLoading] = useState(true)
  const [monthOffset, setMonthOffset] = useState(0)
  const [confirmReset, setConfirmReset] = useState(false)
  const [resetting, setResetting] = useState(false)

  const fetchMine = () => {
    if (!user) return
    setLoading(true)
    let expensesQuery = supabase
      .from('expenses')
      .select('id, list_id, total_amount, created_at, list:lists(name, color, currency)')
      .eq('paid_by', user.id)
    let settlementsQuery = supabase
      .from('settlements')
      .select('id, amount, created_at')
      .eq('to_user', user.id)
      // Solo lo ya confirmado cuenta como "cobrado de verdad" — un pago
      // que alguien dice haber hecho pero que todavía no has confirmado
      // no debe sumar aquí.
      .not('confirmed_at', 'is', null)
    let settlementsPaidQuery = supabase
      .from('settlements')
      .select('id, amount, created_at')
      .eq('from_user', user.id)
      .not('confirmed_at', 'is', null)
    // Corte personal (ver migration_v13.sql): puramente una vista propia,
    // no borra ni afecta a nada compartido con el resto de la lista.
    if (profile?.expenses_reset_at) {
      expensesQuery = expensesQuery.gte('created_at', profile.expenses_reset_at)
      settlementsQuery = settlementsQuery.gte('created_at', profile.expenses_reset_at)
      settlementsPaidQuery = settlementsPaidQuery.gte('created_at', profile.expenses_reset_at)
    }
    Promise.all([
      expensesQuery.order('created_at', { ascending: false }),
      settlementsQuery.order('created_at', { ascending: false }),
      settlementsPaidQuery.order('created_at', { ascending: false }),
    ]).then(([expRes, settRes, settPaidRes]) => {
      setExpenses(((expRes.data as unknown as ExpenseRow[]) ?? []))
      setSettlements(((settRes.data as unknown as SettlementRow[]) ?? []))
      setSettlementsPaid(((settPaidRes.data as unknown as SettlementRow[]) ?? []))
      setLoading(false)
    })
  }

  useEffect(() => {
    fetchMine()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, profile?.expenses_reset_at])

  const doReset = async () => {
    if (!user) return
    setResetting(true)
    const { error: err } = await supabase
      .from('profiles')
      .update({ expenses_reset_at: new Date().toISOString() })
      .eq('id', user.id)
    if (err) showError(t('common.saveError'))
    await refreshProfile()
    setResetting(false)
    setConfirmReset(false)
  }

  const monthDate = useMemo(() => {
    const d = new Date()
    d.setDate(1)
    d.setMonth(d.getMonth() - monthOffset)
    return d
  }, [monthOffset])

  const key = `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, '0')}`
  const monthLabel = monthDate.toLocaleDateString(language === 'en' ? 'en-US' : 'es-ES', { month: 'long', year: 'numeric' })

  const monthExpenses = expenses.filter((e) => monthKey(e.created_at) === key)
  const monthSettlements = settlements.filter((s) => monthKey(s.created_at) === key)
  const monthSettlementsPaid = settlementsPaid.filter((s) => monthKey(s.created_at) === key)

  const byList = useMemo(() => {
    const map = new Map<string, { name: string; color: string | null; currency: CurrencyCode; total: number }>()
    for (const e of monthExpenses) {
      const cur = map.get(e.list_id) ?? {
        name: e.list?.name ?? '—',
        color: e.list?.color ?? null,
        currency: e.list?.currency ?? myCurrency,
        total: 0,
      }
      cur.total += Number(e.total_amount)
      map.set(e.list_id, cur)
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, expenses])

  const totalMonth = monthExpenses.reduce((sum, e) => sum + Number(e.total_amount), 0)
  const totalCollected = monthSettlements.reduce((sum, s) => sum + Number(s.amount), 0)
  const totalSettled = monthSettlementsPaid.reduce((sum, s) => sum + Number(s.amount), 0)
  // Lo que de verdad ha salido de tu bolsillo este mes por gastos
  // compartidos: lo que pagaste directamente al anotar un gasto, MÁS lo que
  // has pagado después para saldar tu parte con alguien — a diferencia de
  // "totalMonth" (arriba), que por sí solo se quedaba corto porque no veía
  // ese segundo tipo de pago. Lo que otros te han devuelto a ti
  // (totalCollected) se resta, porque ese dinero vuelve a tu bolsillo y ya
  // no es un gasto real tuyo.
  const netTotal = totalMonth + totalSettled - totalCollected

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div
        className="glass-panel relative max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-[28px] p-6 shadow-[0_24px_60px_-20px_rgba(20,21,26,0.5)] sm:rounded-[28px]"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          aria-label={t('common.close')}
          title={t('common.close')}
          className="absolute right-4 top-4 rounded-full p-1.5 text-slate-500 dark:text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-200"
        >
          <CloseIcon className="h-4 w-4" />
        </button>
        <h2 className="mb-1 pr-8 text-lg font-semibold text-slate-900 dark:text-slate-100">{t('myExpenses.title')}</h2>
        <div className="mb-4 flex items-center justify-between gap-2">
          {profile?.expenses_reset_at ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {t('myExpenses.resetSince', {
                date: new Date(profile.expenses_reset_at).toLocaleDateString(language === 'en' ? 'en-US' : 'es-ES'),
              })}
            </p>
          ) : (
            <span />
          )}
          <button onClick={() => setConfirmReset(true)} className="text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-red-500 dark:hover:text-red-400">
            {t('myExpenses.resetAction')}
          </button>
        </div>

        <div className="mb-5 flex items-center justify-between">
          <button
            onClick={() => setMonthOffset((o) => o + 1)}
            className="rounded-lg p-2 text-slate-500 dark:text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-200"
            aria-label={t('myExpenses.prevMonth')}
          >
            ‹
          </button>
          <p className="text-sm font-medium capitalize text-slate-700 dark:text-slate-200">{monthLabel}</p>
          <button
            onClick={() => setMonthOffset((o) => Math.max(0, o - 1))}
            disabled={monthOffset === 0}
            className="rounded-lg p-2 text-slate-500 dark:text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-30 dark:hover:bg-slate-700 dark:hover:text-slate-200"
            aria-label={t('myExpenses.nextMonth')}
          >
            ›
          </button>
        </div>

        {loading ? (
          <p className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">{t('common.loading')}</p>
        ) : byList.length === 0 && totalSettled === 0 && totalCollected === 0 ? (
          // Antes esto solo miraba "byList" (los gastos que pagaste
          // directamente): si en el mes solo habías pagado para saldar tu
          // parte, sin haber anotado ningún gasto tú mismo, se veía como
          // "vacío" aunque sí hubiera movimiento real que mostrar.
          <p className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">{t('myExpenses.empty')}</p>
        ) : (
          <>
            {byList.length > 0 && (
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
                        <span className="font-medium text-slate-800 dark:text-slate-100">
                          {formatCurrency(row.total, row.currency, language)}
                        </span>
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
            )}

            {/* Desglose completo antes del Total — para que se entienda de
                dónde sale ese número, en vez de que parezca sacado de la
                manga: lo que pagaste directamente (arriba, por lista), lo
                que has pagado después para saldar tu parte, y lo que te han
                devuelto a ti (esto último restando, porque ese dinero ha
                vuelto a tu bolsillo). */}
            <div className="space-y-1.5 border-t border-[var(--color-glass-border)] pt-3 text-sm">
              <div className="flex items-center justify-between text-slate-600 dark:text-slate-300">
                <span>{t('myExpenses.paidDirectly')}</span>
                <span>{formatCurrency(totalMonth, myCurrency, language)}</span>
              </div>
              {totalSettled > 0 && (
                <div className="flex items-center justify-between text-slate-600 dark:text-slate-300">
                  <span>{t('myExpenses.settled')}</span>
                  <span>{formatCurrency(totalSettled, myCurrency, language)}</span>
                </div>
              )}
              {totalCollected > 0 && (
                <div className="flex items-center justify-between text-green-600 dark:text-green-400">
                  <span>{t('myExpenses.collected')}</span>
                  <span className="font-medium">−{formatCurrency(totalCollected, myCurrency, language)}</span>
                </div>
              )}
              <div className="flex items-center justify-between border-t border-[var(--color-glass-border)] pt-1.5 font-semibold text-slate-900 dark:text-slate-100">
                <span>{t('myExpenses.total')}</span>
                <span>{formatCurrency(netTotal, myCurrency, language)}</span>
              </div>
            </div>
          </>
        )}
      </div>

      {confirmReset && (
        <ConfirmDialog
          title={t('myExpenses.resetConfirmTitle')}
          message={t('myExpenses.resetConfirmMessage')}
          confirmLabel={resetting ? t('common.saving') : t('myExpenses.resetConfirmButton')}
          danger
          onConfirm={doReset}
          onCancel={() => setConfirmReset(false)}
        />
      )}
    </div>,
    document.body,
  )
}
