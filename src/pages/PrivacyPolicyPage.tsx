import { Link } from 'react-router-dom'
import { useLanguage } from '../lib/i18n'
import Logo from '../components/Logo'
import LanguageToggle from '../components/LanguageToggle'

// Página PÚBLICA (sin sesión iniciada) — a propósito fuera del grupo de
// rutas envuelto en <ProtectedRoute> en App.tsx. Google Play exige un
// enlace público a la política de privacidad, así que tiene que poder
// abrirse sin haber iniciado sesión ni tener la app instalada.
//
// El contacto de privacidad usa el email de quien mantiene la app — si
// cambia, se actualiza aquí y en AccountDeletionPage.tsx.
const PRIVACY_CONTACT_EMAIL = 'jorgiitoduran@gmail.com'

export default function PrivacyPolicyPage() {
  const { t } = useLanguage()

  const sections: { title: string; body: string }[] = [
    { title: t('legal.privacyIntroTitle'), body: t('legal.privacyIntroBody') },
    { title: t('legal.privacyDataTitle'), body: t('legal.privacyDataBody') },
    { title: t('legal.privacyUseTitle'), body: t('legal.privacyUseBody') },
    { title: t('legal.privacySharingTitle'), body: t('legal.privacySharingBody') },
    { title: t('legal.privacyRetentionTitle'), body: t('legal.privacyRetentionBody') },
    { title: t('legal.privacyRightsTitle'), body: t('legal.privacyRightsBody') },
    { title: t('legal.privacyMinorsTitle'), body: t('legal.privacyMinorsBody') },
  ]

  return (
    <div className="min-h-screen bg-[var(--color-surface-alt)] px-4 py-10">
      <LanguageToggle />
      <div className="mx-auto max-w-2xl">
        <div className="mb-8 text-center">
          <Logo size={48} className="mx-auto mb-3 rounded-2xl shadow-md" />
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">{t('legal.privacyTitle')}</h1>
          <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">{t('legal.privacyUpdated')}</p>
        </div>

        <div className="space-y-5 rounded-2xl p-6 shadow-sm ring-1 bg-[var(--color-surface)] ring-[var(--color-surface-border)]">
          {sections.map((s) => (
            <section key={s.title}>
              <h2 className="mb-1.5 font-semibold text-slate-900 dark:text-slate-100">{s.title}</h2>
              <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">{s.body}</p>
            </section>
          ))}

          <section className="border-t pt-5 border-[var(--color-surface-border)]">
            <h2 className="mb-1.5 font-semibold text-slate-900 dark:text-slate-100">{t('legal.privacyContactTitle')}</h2>
            <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
              {t('legal.privacyContactBody')}{' '}
              <a href={`mailto:${PRIVACY_CONTACT_EMAIL}`} className="font-medium text-brand-600 underline dark:text-brand-400">
                {PRIVACY_CONTACT_EMAIL}
              </a>
            </p>
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
