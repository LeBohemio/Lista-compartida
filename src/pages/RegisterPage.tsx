import { useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../lib/i18n'
import Logo from '../components/Logo'
import LanguageToggle from '../components/LanguageToggle'

export default function RegisterPage() {
  const { user, signUp } = useAuth()
  const { t } = useLanguage()
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  if (user) return <Navigate to="/lists" replace />

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (username.trim().length < 2) {
      setError(t('auth.usernameTooShort'))
      return
    }
    if (password.length < 6) {
      setError(t('profile.passwordTooShort'))
      return
    }
    setSubmitting(true)
    const { error: err } = await signUp(email.trim(), password, username.trim())
    setSubmitting(false)
    if (err) {
      setError(err)
      return
    }
    setDone(true)
  }

  if (done) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand-500 to-brand-700 px-4">
        <LanguageToggle />
        <div className="w-full max-w-sm rounded-2xl p-6 text-center shadow-lg ring-1 bg-[var(--color-surface)] ring-[var(--color-surface-border)]">
          <h1 className="mb-2 text-xl font-semibold text-slate-900 dark:text-slate-100">{t('auth.accountCreated')}</h1>
          <p className="mb-6 text-sm text-slate-600 dark:text-slate-300">{t('auth.accountCreatedBody')}</p>
          <Link
            to="/login"
            className="block w-full rounded-lg bg-brand-600 px-4 py-2.5 font-medium text-white hover:bg-brand-700"
          >
            {t('auth.goToLogin')}
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand-500 to-brand-700 px-4">
      <LanguageToggle />
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <Logo size={56} className="mx-auto mb-3 rounded-2xl shadow-lg ring-2 ring-white/30" />
          <h1 className="text-2xl font-semibold text-white">{t('auth.createAccount')}</h1>
          <p className="mt-1 text-sm text-white/80">{t('auth.registerTagline')}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 rounded-2xl p-6 shadow-sm ring-1 bg-[var(--color-surface)] ring-[var(--color-surface-border)]">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">{t('auth.username')}</label>
            <input
              type="text"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full rounded-lg border px-3 py-2.5 text-base focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 border-[var(--color-surface-border)] bg-[var(--color-surface-alt)] dark:text-slate-100"
              placeholder={t('auth.usernamePlaceholder')}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">{t('auth.email')}</label>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border px-3 py-2.5 text-base focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 border-[var(--color-surface-border)] bg-[var(--color-surface-alt)] dark:text-slate-100"
              placeholder={t('auth.emailPlaceholder')}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">{t('auth.password')}</label>
            <input
              type="password"
              required
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border px-3 py-2.5 text-base focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 border-[var(--color-surface-border)] bg-[var(--color-surface-alt)] dark:text-slate-100"
              placeholder={t('auth.passwordMinPlaceholder')}
            />
          </div>

          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/40 dark:text-red-400">{error}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg bg-brand-600 px-4 py-2.5 font-medium text-white transition hover:bg-brand-700 disabled:opacity-60"
          >
            {submitting ? t('auth.creatingAccount') : t('auth.createAccount')}
          </button>

          <p className="text-center text-xs text-slate-400 dark:text-slate-500">
            {t('legal.privacyLinkRegister')}{' '}
            <Link to="/legal/privacidad" className="underline hover:text-slate-600 dark:hover:text-slate-300">
              {t('legal.privacyLinkSettings').toLowerCase()}
            </Link>
            .
          </p>
        </form>

        <p className="mt-6 text-center text-sm text-white/80">
          {t('auth.haveAccount')}{' '}
          <Link to="/login" className="font-semibold text-white underline underline-offset-2 hover:text-white/90">
            {t('auth.signIn')}
          </Link>
        </p>
      </div>
    </div>
  )
}
