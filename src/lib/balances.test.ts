import { describe, expect, it } from 'vitest'
import { computeNetBalances, formatCurrency, simplifyDebts, splitEqually } from './balances'
import type { Expense, Settlement } from './types'

// Helper para construir un gasto de prueba sin tener que rellenar todos los
// campos de Expense cada vez.
function makeExpense(
  overrides: Omit<Partial<Expense>, 'shares'> & { shares: { user_id: string; amount: number }[] },
): Expense {
  return {
    id: overrides.id ?? 'expense-1',
    list_id: 'list-1',
    description: null,
    total_amount: overrides.total_amount ?? 0,
    receipt_image_path: null,
    ocr_confidence: null,
    category: 'otros',
    paid_by: overrides.paid_by ?? null,
    created_by: null,
    created_at: new Date().toISOString(),
    is_draft: false,
    shares: overrides.shares.map((s, i) => ({
      id: `share-${i}`,
      expense_id: overrides.id ?? 'expense-1',
      user_id: s.user_id,
      amount: s.amount,
    })),
  }
}

function makeSettlement(overrides: Partial<Settlement>): Settlement {
  return {
    id: overrides.id ?? 'settlement-1',
    list_id: 'list-1',
    from_user: overrides.from_user ?? null,
    to_user: overrides.to_user ?? null,
    amount: overrides.amount ?? 0,
    note: null,
    created_by: null,
    created_at: new Date().toISOString(),
  }
}

describe('splitEqually', () => {
  it('reparte un importe exactamente divisible a partes iguales', () => {
    const result = splitEqually(3000, ['a', 'b', 'c'])
    expect(result).toEqual({ a: 1000, b: 1000, c: 1000 })
  })

  it('reparte el resto de céntimos entre las primeras personas, sin perder ni un céntimo', () => {
    // 1000 céntimos entre 3 personas -> 333, 333, 334
    const result = splitEqually(1000, ['a', 'b', 'c'])
    const total = Object.values(result).reduce((sum, c) => sum + c, 0)
    expect(total).toBe(1000)
    expect(result.a).toBe(334) // la primera persona se lleva el céntimo sobrante
    expect(result.b).toBe(333)
    expect(result.c).toBe(333)
  })

  it('nunca deja que la suma de lo repartido difiera del total, para muchos casos aleatorios', () => {
    for (let trial = 0; trial < 200; trial++) {
      const totalCents = Math.floor(Math.random() * 100000)
      const n = 1 + Math.floor(Math.random() * 12)
      const userIds = Array.from({ length: n }, (_, i) => `user-${i}`)
      const result = splitEqually(totalCents, userIds)
      const sum = Object.values(result).reduce((s, c) => s + c, 0)
      expect(sum).toBe(totalCents)
    }
  })

  it('da todo el importe a la única persona cuando solo hay una', () => {
    const result = splitEqually(999, ['a'])
    expect(result).toEqual({ a: 999 })
  })

  it('devuelve un objeto vacío si no hay nadie con quien repartir', () => {
    expect(splitEqually(1000, [])).toEqual({})
  })

  it('reparte un importe de 0 sin fallar', () => {
    const result = splitEqually(0, ['a', 'b'])
    expect(result).toEqual({ a: 0, b: 0 })
  })
})

describe('computeNetBalances', () => {
  it('un gasto pagado y repartido entre 2 personas deja a quien paga con crédito', () => {
    const expenses = [
      makeExpense({
        total_amount: 20,
        paid_by: 'alice',
        shares: [
          { user_id: 'alice', amount: 10 },
          { user_id: 'bob', amount: 10 },
        ],
      }),
    ]
    const balances = computeNetBalances(expenses, [])
    expect(balances.alice).toBeCloseTo(10) // pagó 20, le tocaban 10 -> le deben 10
    expect(balances.bob).toBeCloseTo(-10) // no pagó nada, le tocaban 10 -> debe 10
  })

  it('si alguien paga y también forma parte del reparto, su balance neto lo refleja', () => {
    // Cena de 30€ entre 3, paga Carla.
    const expenses = [
      makeExpense({
        total_amount: 30,
        paid_by: 'carla',
        shares: [
          { user_id: 'carla', amount: 10 },
          { user_id: 'dani', amount: 10 },
          { user_id: 'eva', amount: 10 },
        ],
      }),
    ]
    const balances = computeNetBalances(expenses, [])
    expect(balances.carla).toBeCloseTo(20) // pagó 30, le tocaban 10
    expect(balances.dani).toBeCloseTo(-10)
    expect(balances.eva).toBeCloseTo(-10)
  })

  it('varios gastos se acumulan correctamente en el balance de cada persona', () => {
    const expenses = [
      makeExpense({
        id: 'e1',
        total_amount: 20,
        paid_by: 'alice',
        shares: [
          { user_id: 'alice', amount: 10 },
          { user_id: 'bob', amount: 10 },
        ],
      }),
      makeExpense({
        id: 'e2',
        total_amount: 10,
        paid_by: 'bob',
        shares: [
          { user_id: 'alice', amount: 5 },
          { user_id: 'bob', amount: 5 },
        ],
      }),
    ]
    const balances = computeNetBalances(expenses, [])
    // Alice: +10 (crédito del primero) -5 (parte del segundo) = +5
    expect(balances.alice).toBeCloseTo(5)
    // Bob: -10 (parte del primero) +5 (crédito del segundo) = -5
    expect(balances.bob).toBeCloseTo(-5)
  })

  it('una liquidación (settlement) reduce la deuda de quien paga y el crédito de quien cobra', () => {
    const expenses = [
      makeExpense({
        total_amount: 20,
        paid_by: 'alice',
        shares: [
          { user_id: 'alice', amount: 10 },
          { user_id: 'bob', amount: 10 },
        ],
      }),
    ]
    const settlements = [makeSettlement({ from_user: 'bob', to_user: 'alice', amount: 10 })]
    const balances = computeNetBalances(expenses, settlements)
    expect(balances.alice).toBeCloseTo(0)
    expect(balances.bob).toBeCloseTo(0)
  })

  it('una liquidación parcial disminuye la deuda sin saldarla del todo', () => {
    const expenses = [
      makeExpense({
        total_amount: 20,
        paid_by: 'alice',
        shares: [
          { user_id: 'alice', amount: 10 },
          { user_id: 'bob', amount: 10 },
        ],
      }),
    ]
    const settlements = [makeSettlement({ from_user: 'bob', to_user: 'alice', amount: 4 })]
    const balances = computeNetBalances(expenses, settlements)
    expect(balances.alice).toBeCloseTo(6)
    expect(balances.bob).toBeCloseTo(-6)
  })

  it('no explota con importes con decimales que suelen dar problemas de coma flotante', () => {
    // 10.10€ entre 3 -> en euros "de verdad" 3.3666..., aquí probamos que al
    // trabajar en céntimos no se acumula basura de coma flotante.
    const expenses = [
      makeExpense({
        total_amount: 10.1,
        paid_by: 'alice',
        shares: [
          { user_id: 'alice', amount: 3.37 },
          { user_id: 'bob', amount: 3.37 },
          { user_id: 'carla', amount: 3.36 },
        ],
      }),
    ]
    const balances = computeNetBalances(expenses, [])
    expect(balances.alice).toBeCloseTo(10.1 - 3.37, 5)
    expect(balances.bob).toBeCloseTo(-3.37, 5)
    expect(balances.carla).toBeCloseTo(-3.36, 5)
  })

  it('ignora gastos sin pagador o repartos sin usuario asignado, sin romperse', () => {
    const expenses = [
      makeExpense({
        total_amount: 20,
        paid_by: null,
        shares: [
          { user_id: 'alice', amount: 10 },
          { user_id: null as unknown as string, amount: 10 },
        ],
      }),
    ]
    expect(() => computeNetBalances(expenses, [])).not.toThrow()
    const balances = computeNetBalances(expenses, [])
    expect(balances.alice).toBeCloseTo(-10)
  })
})

describe('simplifyDebts', () => {
  it('no sugiere ninguna deuda si todos los balances están a cero', () => {
    expect(simplifyDebts({ alice: 0, bob: 0 })).toEqual([])
  })

  it('el caso simple de dos personas genera una sola deuda directa', () => {
    const debts = simplifyDebts({ alice: 10, bob: -10 })
    expect(debts).toEqual([{ from: 'bob', to: 'alice', amount: 10 }])
  })

  it('resuelve un ciclo de tres personas con el mínimo de transacciones', () => {
    // Alice pagó de más, Carla debe, Bob está a cero -> 1 sola transacción.
    const debts = simplifyDebts({ alice: 15, bob: 0, carla: -15 })
    expect(debts).toHaveLength(1)
    expect(debts[0]).toEqual({ from: 'carla', to: 'alice', amount: 15 })
  })

  it('las deudas sugeridas siempre netean exactamente los balances originales', () => {
    const netBalances = { alice: 23.5, bob: -10.25, carla: -8.75, dani: -4.5 }
    const debts = simplifyDebts(netBalances)

    const netFromDebts: Record<string, number> = {}
    for (const d of debts) {
      netFromDebts[d.from] = (netFromDebts[d.from] ?? 0) - d.amount
      netFromDebts[d.to] = (netFromDebts[d.to] ?? 0) + d.amount
    }
    for (const [user, balance] of Object.entries(netBalances)) {
      expect(netFromDebts[user] ?? 0).toBeCloseTo(balance, 2)
    }
  })

  it('nunca sugiere una deuda con importe negativo o cero', () => {
    const debts = simplifyDebts({ alice: 5.5, bob: 3.25, carla: -8.75 })
    for (const d of debts) {
      expect(d.amount).toBeGreaterThan(0)
    }
  })
})

describe('formatCurrency', () => {
  it('formatea importes positivos en euros por defecto', () => {
    expect(formatCurrency(10)).toContain('10')
    expect(formatCurrency(10)).toContain('€')
  })

  it('redondea a dos decimales', () => {
    expect(formatCurrency(10.005)).toMatch(/10[.,]0[01]\s?€/)
  })

  it('formatea cero correctamente', () => {
    expect(formatCurrency(0)).toContain('0')
  })

  it('cambia el símbolo según la divisa, sin convertir el número', () => {
    expect(formatCurrency(10, 'USD', 'en')).toContain('10')
    expect(formatCurrency(10, 'USD', 'en')).toContain('$')
    expect(formatCurrency(10, 'GBP', 'en')).toContain('£')
  })

  it('usa el separador decimal correcto según el idioma (coma en español, punto en inglés)', () => {
    expect(formatCurrency(10.5, 'EUR', 'es')).toMatch(/10,5/)
    expect(formatCurrency(10.5, 'USD', 'en')).toMatch(/10\.5/)
  })
})
