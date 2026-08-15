import type { ExpenseCategory } from './types'
import type { TranslationKey } from './i18n'

export const EXPENSE_CATEGORIES: { value: ExpenseCategory; labelKey: TranslationKey; icon: string }[] = [
  { value: 'comida', labelKey: 'expenseCategory.comida', icon: '🍔' },
  { value: 'transporte', labelKey: 'expenseCategory.transporte', icon: '🚗' },
  { value: 'alojamiento', labelKey: 'expenseCategory.alojamiento', icon: '🏨' },
  { value: 'ocio', labelKey: 'expenseCategory.ocio', icon: '🎉' },
  { value: 'compras', labelKey: 'expenseCategory.compras', icon: '🛍️' },
  { value: 'otros', labelKey: 'expenseCategory.otros', icon: '📦' },
]

export function categoryIcon(category: ExpenseCategory | null | undefined): string {
  return EXPENSE_CATEGORIES.find((c) => c.value === category)?.icon ?? '📦'
}
