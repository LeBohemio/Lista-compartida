import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useLanguage } from '../lib/i18n'

export default function InviteMemberModal({
  listId,
  onClose,
  onInvited,
}: {
  listId: string
  onClose: () => void
  onInvited: () => void
}) {
  const { t } = useLanguage()
  const [identifier, setIdentifier] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [shareFeedback, setShareFeedback] = useState<string | null>(null)

  const shareApp = async () => {
    const text = t('invite.shareText')
    const url = window.location.origin
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Listas en Común', text, url })
      } catch {
        // el usuario canceló el share sheet
      }
      return
    }
    try {
      await navigator.clipboard.writeText(`${text} ${url}`)
      setShareFeedback(t('chat.copied'))
      setTimeout(() => setShareFeedback(null), 2500)
    } catch {
      setShareFeedback(t('invite.errorCopyLink'))
      setTimeout(() => setShareFeedback(null), 2500)
    }
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setSuccess(null)
    const value = identifier.trim().toLowerCase()
    if (!value) return
    setSubmitting(true)

    const { data: profile, error: findErr } = await supabase
      .from('profiles')
      .select('*')
      .or(`email.eq.${value},username.eq.${value}`)
      .maybeSingle()

    if (findErr) {
      setError(findErr.message)
      setSubmitting(false)
      return
    }
    if (!profile) {
      setError(t('invite.errorNotFound'))
      setSubmitting(false)
      return
    }

    const { error: insertErr } = await supabase.from('list_members').insert({
      list_id: listId,
      user_id: profile.id,
      role: 'member',
      status: 'invited',
      invited_identifier: value,
    })

    setSubmitting(false)
    if (insertErr) {
      if (insertErr.code === '23505') {
        setError(t('invite.errorAlreadyMember'))
      } else {
        setError(insertErr.message)
      }
      return
    }

    setSuccess(t('invite.successSent', { name: profile.username }))
    setIdentifier('')
    onInvited()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-t-2xl p-6 shadow-xl sm:rounded-2xl bg-[var(--color-surface)]"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-1 text-lg font-semibold text-slate-900 dark:text-slate-100">{t('invite.title')}</h2>
        <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">{t('invite.body')}</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="text"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            placeholder={t('invite.placeholder')}
            autoFocus
            className="w-full rounded-lg border px-3 py-2.5 text-base focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 border-[var(--color-surface-border)] bg-[var(--color-surface-alt)] dark:text-slate-100"
          />

          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/40 dark:text-red-400">{error}</p>}
          {success && <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700 dark:bg-green-950/40 dark:text-green-400">{success}</p>}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-lg border px-4 py-2.5 font-medium text-slate-700 hover:bg-slate-50 border-[var(--color-surface-border)] dark:text-slate-200 dark:hover:bg-slate-700"
            >
              {t('common.close')}
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 rounded-lg bg-brand-600 px-4 py-2.5 font-medium text-white hover:bg-brand-700 disabled:opacity-60"
            >
              {submitting ? t('invite.inviting') : t('invite.submit')}
            </button>
          </div>
        </form>

        <div className="mt-5 border-t border-slate-100 pt-4 text-center border-[var(--color-surface-border)]">
          <button
            type="button"
            onClick={shareApp}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-brand-600 hover:bg-brand-50 dark:text-brand-400 dark:hover:bg-brand-950/40"
          >
            {t('invite.shareApp')}
          </button>
          {shareFeedback && <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{shareFeedback}</p>}
        </div>
      </div>
    </div>
  )
}
