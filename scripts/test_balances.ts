import { computeNetBalances, simplifyDebts } from '../src/lib/balances'
import type { Expense, Settlement } from '../src/lib/types'

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error('❌ FAIL:', msg)
    process.exitCode = 1
  } else {
    console.log('✓', msg)
  }
}

const A = 'user-a'
const B = 'user-b'
const C = 'user-c'

// Escenario: A paga 30€ de un ticket, repartido a partes iguales entre A, B, C (10€ cada uno)
const expenses: Expense[] = [
  {
    id: 'e1',
    list_id: 'l1',
    description: 'Supermercado',
    total_amount: 30,
    receipt_image_path: null,
    ocr_confidence: 90,
    paid_by: A,
    created_by: A,
    created_at: new Date().toISOString(),
    shares: [
      { id: 's1', expense_id: 'e1', user_id: A, amount: 10 },
      { id: 's2', expense_id: 'e1', user_id: B, amount: 10 },
      { id: 's3', expense_id: 'e1', user_id: C, amount: 10 },
    ],
  },
]

let balances = computeNetBalances(expenses, [])
assert(balances[A] === 20, `A debe tener +20 (pagó 30, le tocaban 10) — obtenido ${balances[A]}`)
assert(balances[B] === -10, `B debe tener -10 — obtenido ${balances[B]}`)
assert(balances[C] === -10, `C debe tener -10 — obtenido ${balances[C]}`)

let debts = simplifyDebts(balances)
assert(debts.length === 2, `Debe haber 2 transacciones sugeridas — obtenidas ${debts.length}`)
assert(
  debts.every((d) => d.to === A && (d.from === B || d.from === C) && d.amount === 10),
  `Todas las deudas deben ser de 10€ hacia A — ${JSON.stringify(debts)}`,
)

// B salda su deuda completa con A
const settlements: Settlement[] = [
  {
    id: 'st1',
    list_id: 'l1',
    from_user: B,
    to_user: A,
    amount: 10,
    note: null,
    created_by: B,
    created_at: new Date().toISOString(),
  },
]

balances = computeNetBalances(expenses, settlements)
assert(balances[A] === 10, `Tras saldar, A debe tener +10 — obtenido ${balances[A]}`)
assert(balances[B] === 0, `Tras saldar, B debe tener 0 — obtenido ${balances[B]}`)
assert(balances[C] === -10, `C sigue debiendo 10 — obtenido ${balances[C]}`)

debts = simplifyDebts(balances)
assert(debts.length === 1, `Solo debe quedar 1 deuda pendiente — obtenidas ${debts.length}`)
assert(debts[0].from === C && debts[0].to === A && debts[0].amount === 10, `La deuda restante debe ser C->A 10€ — ${JSON.stringify(debts[0])}`)

// Reparto personalizado con importes que no son iguales, y comprobación de redondeo a céntimos
const expenses2: Expense[] = [
  {
    id: 'e2',
    list_id: 'l1',
    description: 'Cena',
    total_amount: 100,
    receipt_image_path: null,
    ocr_confidence: null,
    paid_by: B,
    created_by: B,
    created_at: new Date().toISOString(),
    shares: [
      { id: 's4', expense_id: 'e2', user_id: A, amount: 33.33 },
      { id: 's5', expense_id: 'e2', user_id: B, amount: 33.34 },
      { id: 's6', expense_id: 'e2', user_id: C, amount: 33.33 },
    ],
  },
]
const balances2 = computeNetBalances(expenses2, [])
const total = Object.values(balances2).reduce((a, b) => a + b, 0)
assert(Math.abs(total) < 0.001, `La suma de balances netos debe ser 0 (sin fugas de céntimos) — obtenido ${total}`)

console.log('\nTodas las comprobaciones de balances.ts ejecutadas.')
