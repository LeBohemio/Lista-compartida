import { Link } from 'react-router-dom'
import { useLanguage } from '../lib/i18n'
import Logo from '../components/Logo'
import LanguageToggle from '../components/LanguageToggle'

// Página PÚBLICA (sin sesión iniciada) — la segunda vía de borrado de
// cuenta que exige Google Play además del borrado ya existente DENTRO de la
// app (ver DeleteAccountDialog.tsx). Al no requerir sesión, no puede
// verificar quién eres automáticamente: por eso pide escribir desde el
// propio email de la cuenta, y el borrado real se confirma a mano — ver el
// comentario de la sección "fuera de la app" más abajo.
const CONTACT_EMAIL = 'soporte.noteus@gmail.com'

export default function AccountDeletionPage() {
  const { t } = useLanguage()
  const subject = encodeURIComponent(t('legal.deletionEmailSubject'))
  const mailtoHref = `mailto:${CONTACT_EMAIL}?subject=${subject}`

  return (
    <div className="min-h-screen bg-[var(--color-surface-alt)] px-4 py-10">
      <LanguageToggle />
      <div className="mx-auto max-w-2xl">
        <div className="mb-8 text-center">
          <Logo size={48} className="mx-auto mb-3 rounded-2xl shadow-md" />
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">{t('legal.deletionTitle')}</h1>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t('legal.deletionUpdated')}</p>
        </div>

        <div className="space-y-5 rounded-2xl p-6 shadow-sm ring-1 bg-[var(--color-surface)] ring-[var(--color-surface-border)]">
          <section>
            <h2 className="mb-1.5 font-semibold text-slate-900 dark:text-slate-100">{t('legal.deletionInAppTitle')}</h2>
            <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">{t('legal.deletionInAppBody')}</p>
          </section>

          <section className="border-t pt-5 border-[var(--color-surface-border)]">
            <h2 className="mb-1.5 font-semibold text-slate-900 dark:text-slate-100">{t('legal.deletionOutsideTitle')}</h2>
            <p className="mb-3 text-sm leading-relaxed text-slate-600 dark:text-slate-300">{t('legal.deletionOutsideBody')}</p>
            <a
              href={mailtoHref}
              className="inline-block rounded-full bg-gradient-to-br from-red-500 to-red-600 px-4 py-2.5 text-sm font-medium text-white shadow-[0_10px_22px_-10px_rgba(220,38,38,0.5)]"
            >
              {t('legal.deletionEmailButton')}
            </a>
          </section>

          <section className="border-t pt-5 border-[var(--color-surface-border)]">
            <h2 className="mb-1.5 font-semibold text-slate-900 dark:text-slate-100">{t('legal.deletionWhatTitle')}</h2>
            <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">{t('legal.deletionWhatBody')}</p>
          </section>
        </div>

        <p className="mt-6 text-center text-sm">
          <Link
            to="/"
            className="font-medium text-brand-600 underline underline-offset-2 dark:text-brand-400"
          >
            {t('legal.backToApp')}
          </Link>
        </p>
      </div>
    </div>
  )
}
