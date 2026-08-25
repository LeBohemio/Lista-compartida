import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useLanguage } from '../lib/i18n'
import Logo from '../components/Logo'

export default function ResetPasswordPage() {
  const navigate = useNavigate()
  const { t } = useLanguage()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (password.length < 6) {
      setError(t('profile.passwordTooShort'))
      return
    }
    if (password !== confirm) {
      setError(t('profile.passwordsDontMatch'))
      return
    }
    setSubmitting(true)
    const { error: err } = await supabase.auth.updateUser({ password })
    setSubmitting(false)
    if (err) {
      setError(err.message.toLowerCase().includes('session') ? t('auth.linkExpired') : err.message)
      return
    }
    setDone(true)
  }

  if (done) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand-500 to-brand-700 px-4">
        <div className="w-full max-w-sm rounded-2xl p-6 text-center shadow-lg ring-1 bg-[var(--color-surface)] ring-[var(--color-surface-border)]">
          <h1 className="mb-2 text-xl font-semibold text-slate-900 dark:text-slate-100">{t('auth.passwordUpdatedTitle')}</h1>
          <p className="mb-6 text-sm text-slate-600 dark:text-slate-300">{t('auth.passwordUpdatedBody')}</p>
          <button
            onClick={() => navigate('/login')}
            className="block w-full rounded-lg bg-brand-600 px-4 py-2.5 font-medium text-white hover:bg-brand-700"
          >
            {t('auth.goToLogin')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand-500 to-brand-700 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <Logo size={56} className="mx-auto mb-3 rounded-2xl shadow-lg ring-2 ring-white/30" />
          <h1 className="text-2xl font-semibold text-white">{t('auth.resetTitle')}</h1>
          <p className="mt-1 text-sm text-white/80">{t('auth.resetTagline')}</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="space-y-4 rounded-2xl p-6 shadow-sm ring-1 bg-[var(--color-surface)] ring-[var(--color-surface-border)]"
        >
          <div>
            <label htmlFor="reset-new-password" className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
              {t('profile.newPassword')}
            </label>
            <input
              id="reset-new-password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border px-3 py-2.5 text-base focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 border-[var(--color-surface-border)] bg-[var(--color-surface-alt)] dark:text-slate-100"
              placeholder={t('auth.passwordMinPlaceholder')}
            />
          </div>
          <div>
            <label htmlFor="reset-confirm-password" className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
              {t('profile.repeatPassword')}
            </label>
            <input
              id="reset-confirm-password"
              type="password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="w-full rounded-lg border px-3 py-2.5 text-base focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 border-[var(--color-surface-border)] bg-[var(--color-surface-alt)] dark:text-slate-100"
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
            {submitting ? t('common.saving') : t('auth.savePassword')}
          </button>
        </form>
      </div>
    </div>
  )
}
