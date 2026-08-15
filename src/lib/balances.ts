import type { Expense, NetBalance, Settlement, SuggestedDebt } from './types'

const toCents = (n: number) => Math.round(n * 100)
const fromCents = (c: number) => Math.round(c) / 100

/**
 * Calcula el balance neto por usuario en una lista:
 *   positivo => el resto de la lista le debe dinero (ha pagado de más)
 *   negativo => esta persona debe dinero al resto
 *
 * Se construye a partir de:
 *  - Gastos: quien paga (`paid_by`) recibe +total, y cada reparto (`shares`)
 *    resta su parte correspondiente (incluida la del propio pagador).
 *  - Liquidaciones (`settlements`): un pago directo de una persona a otra
 *    reduce la deuda de quien paga y reduce el crédito de quien cobra.
 */
export function computeNetBalances(expenses: Expense[], settlements: Settlement[]): NetBalance {
  const centsByUser = new Map<string, number>()
  const add = (userId: string, cents: number) => {
    centsByUser.set(userId, (centsByUser.get(userId) ?? 0) + cents)
  }

  for (const expense of expenses) {
    if (expense.paid_by) add(expense.paid_by, toCents(expense.total_amount))
    for (const share of expense.shares ?? []) {
      if (share.user_id) add(share.user_id, -toCents(share.amount))
    }
  }

  for (const s of settlements) {
    // from_user salda deuda -> su balance mejora (menos negativo)
    if (s.from_user) add(s.from_user, toCents(s.amount))
    // to_user ya cobró -> su crédito pendiente baja
    if (s.to_user) add(s.to_user, -toCents(s.amount))
  }

  const result: NetBalance = {}
  for (const [userId, cents] of centsByUser.entries()) {
    result[userId] = fromCents(cents)
  }
  return result
}

/**
 * Algoritmo greedy de "settle up": empareja al mayor acreedor con el mayor
 * deudor repetidamente hasta saldar todos los balances netos, minimizando
 * el número de transacciones sugeridas ("X debe Y€ a Z").
 */
export function simplifyDebts(netBalances: NetBalance): SuggestedDebt[] {
  const creditors: { id: string; cents: number }[] = []
  const debtors: { id: string; cents: number }[] = []

  for (const [id, amount] of Object.entries(netBalances)) {
    const cents = toCents(amount)
    if (cents > 0) creditors.push({ id, cents })
    else if (cents < 0) debtors.push({ id, cents: -cents })
  }

  creditors.sort((a, b) => b.cents - a.cents)
  debtors.sort((a, b) => b.cents - a.cents)

  const debts: SuggestedDebt[] = []
  let i = 0
  let j = 0
  while (i < debtors.length && j < creditors.length) {
    const debtor = debtors[i]
    const creditor = creditors[j]
    const amount = Math.min(debtor.cents, creditor.cents)
    if (amount > 0) {
      debts.push({ from: debtor.id, to: creditor.id, amount: fromCents(amount) })
    }
    debtor.cents -= amount
    creditor.cents -= amount
    if (debtor.cents === 0) i++
    if (creditor.cents === 0) j++
  }

  return debts
}

export function formatEuro(amount: number): string {
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(amount)
}

/**
 * Reparte `totalCents` entre `userIds` a partes iguales, en céntimos, sin
 * perder ni un céntimo por redondeo: el cociente entero va para todos, y el
 * resto (que siempre es menor que el número de personas) se reparte de uno
 * en uno entre las primeras personas de la lista. La suma de lo repartido
 * siempre coincide exactamente con `totalCents`.
 */
export function splitEqually(totalCents: number, userIds: string[]): Record<string, number> {
  const n = userIds.length
  if (n === 0) return {}
  const base = Math.floor(totalCents / n)
  let remainder = totalCents - base * n
  const result: Record<string, number> = {}
  for (const id of userIds) {
    result[id] = base + (remainder > 0 ? 1 : 0)
    if (remainder > 0) remainder--
  }
  return result
}
