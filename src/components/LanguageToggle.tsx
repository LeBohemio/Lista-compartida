import { useLanguage } from '../lib/i18n'
import type { Language } from '../lib/types'

const OPTIONS: { value: Language; label: string }[] = [
  { value: 'es', label: 'ES' },
  { value: 'en', label: 'EN' },
]

/**
 * Pastilla ES/EN fija en la esquina superior derecha — pensada para las
 * pantallas de antes de entrar (crear cuenta / iniciar sesión), donde
 * todavía no hay ningún sitio dentro de la app para cambiar de idioma. El
 * idioma por defecto sigue siendo español; esto solo le da a quien prefiera
 * inglés la opción de cambiarlo ya desde el principio, en vez de tener que
 * registrarse en español y buscarlo luego en su perfil.
 */
export default function LanguageToggle() {
  const { language, setLanguage } = useLanguage()
  return (
    <div className="fixed right-4 top-4 z-10 flex gap-1 rounded-full border p-1 shadow-sm bg-[var(--color-surface)] border-[var(--color-surface-border)]">
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => setLanguage(opt.value)}
          aria-pressed={language === opt.value}
          className={`rounded-full px-2.5 py-1 text-xs font-semibold transition ${
            language === opt.value
              ? 'bg-brand-600 text-white'
              : 'text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}
