import { useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../lib/i18n'
import Logo from '../components/Logo'
import ForgotPasswordModal from '../components/ForgotPasswordModal'
import LanguageToggle from '../components/LanguageToggle'

export default function LoginPage() {
  const { user, signIn } = useAuth()
  const { t } = useLanguage()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [showForgot, setShowForgot] = useState(false)

  if (user) return <Navigate to={(location.state as any)?.from ?? '/lists'} replace />

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    const { error: err } = await signIn(email.trim(), password)
    setSubmitting(false)
    if (err) setError(err)
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand-500 to-brand-700 px-4">
      <LanguageToggle />
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <Logo size={56} className="mx-auto mb-3 rounded-2xl shadow-lg ring-2 ring-white/30" />
          <h1 className="text-2xl font-semibold text-white">NoteUs</h1>
          <p className="mt-1 text-sm text-white/80">{t('auth.appTagline')}</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="space-y-4 rounded-2xl p-6 shadow-sm ring-1 bg-[var(--color-surface)] ring-[var(--color-surface-border)]"
        >
          <div>
            <label htmlFor="login-email" className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">{t('auth.email')}</label>
            <input
              id="login-email"
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
            <div className="mb-1 flex items-center justify-between">
              <label htmlFor="login-password" className="block text-sm font-medium text-slate-700 dark:text-slate-300">{t('auth.password')}</label>
              <button
                type="button"
                onClick={() => setShowForgot(true)}
                className="text-xs font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300"
              >
                {t('auth.forgotPassword')}
              </button>
            </div>
            <input
              id="login-password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border px-3 py-2.5 text-base focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 border-[var(--color-surface-border)] bg-[var(--color-surface-alt)] dark:text-slate-100"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/40 dark:text-red-400">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg bg-brand-600 px-4 py-2.5 font-medium text-white transition hover:bg-brand-700 disabled:opacity-60"
          >
            {submitting ? t('auth.entering') : t('auth.enter')}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-white/80">
          {t('auth.noAccount')}{' '}
          <Link to="/register" className="font-semibold text-white underline underline-offset-2 hover:text-white/90">
            {t('auth.register')}
          </Link>
        </p>
      </div>

      {showForgot && <ForgotPasswordModal onClose={() => setShowForgot(false)} />}
    </div>
  )
}
