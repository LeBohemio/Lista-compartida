export type CurrencyCode = 'EUR' | 'USD' | 'GBP' | 'MXN' | 'ARS' | 'COP' | 'CLP' | 'CHF' | 'JPY' | 'BRL'

// Símbolo y bandera de cada divisa soportada. No hay conversión entre ellas:
// elegir una divisa distinta solo cambia cómo se formatea el número (el
// símbolo, dónde va, separador de miles/decimales…), nunca recalcula el
// importe.
export const CURRENCIES: { code: CurrencyCode; flag: string; symbol: string }[] = [
  { code: 'EUR', flag: '🇪🇺', symbol: '€' },
  { code: 'USD', flag: '🇺🇸', symbol: '$' },
  { code: 'GBP', flag: '🇬🇧', symbol: '£' },
  { code: 'MXN', flag: '🇲🇽', symbol: '$' },
  { code: 'ARS', flag: '🇦🇷', symbol: '$' },
  { code: 'COP', flag: '🇨🇴', symbol: '$' },
  { code: 'CLP', flag: '🇨🇱', symbol: '$' },
  { code: 'CHF', flag: '🇨🇭', symbol: 'Fr' },
  { code: 'JPY', flag: '🇯🇵', symbol: '¥' },
  { code: 'BRL', flag: '🇧🇷', symbol: 'R$' },
]

export const DEFAULT_CURRENCY: CurrencyCode = 'EUR'

export function currencySymbol(code: CurrencyCode | string | null | undefined): string {
  return CURRENCIES.find((c) => c.code === code)?.symbol ?? '€'
}
