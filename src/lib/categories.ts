import type { ExpenseCategory } from './types'

export const EXPENSE_CATEGORIES: { value: ExpenseCategory; label: string; icon: string }[] = [
  { value: 'comida', label: 'Comida', icon: '🍔' },
  { value: 'transporte', label: 'Transporte', icon: '🚗' },
  { value: 'alojamiento', label: 'Alojamiento', icon: '🏨' },
  { value: 'ocio', label: 'Ocio', icon: '🎉' },
  { value: 'compras', label: 'Compras', icon: '🛍️' },
  { value: 'otros', label: 'Otros', icon: '📦' },
]

export function categoryIcon(category: ExpenseCategory | null | undefined): string {
  return EXPENSE_CATEGORIES.find((c) => c.value === category)?.icon ?? '📦'
}
