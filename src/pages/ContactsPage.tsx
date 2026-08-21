import { useState, type FormEvent } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import Avatar from '../components/Avatar'
import ConfirmDialog from '../components/ConfirmDialog'
import ContactCardSheet from '../components/ContactCardSheet'
import { useLanguage } from '../lib/i18n'
import { isCurrentlyMuted } from '../lib/mute'
import type { Contact, ContactRequest, Profile } from '../lib/types'
import type { ContactRequestsData } from '../hooks/useContactRequests'

export default function ContactsPage() {
  const { user, profile } = useAuth()
  const { t } = useLanguage()
  const navigate = useNavigate()
  const { contacts, incoming, outgoing, loading, error: loadError, refetch } =
    useOutletContext<ContactRequestsData>()

  const [search, setSearch] = useState('')
  const [cardTarget, setCardTarget] = useState<Profile | null>(null)
  const [removing, setRemoving] = useState<Contact | null>(null)
  const [removingBusy, setRemovingBusy] = useState(false)
  const [respondingId, setRespondingId] = useState<string | null>(null)
  const [cancellingId, setCancellingId] = useState<string | null>(null)
  const [addEmail, setAddEmail] = useState('')
  const [addSubmitting, setAddSubmitting] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const [addSuccess, setAddSuccess] = useState<string | null>(null)

  const normalizedSearch = search.trim().toLowerCase()
  const visibleContacts = contacts
    .filter((c) => c.contact)
    .filter((c) => !normalizedSearch || c.contact!.username.toLowerCase().includes(normalizedSearch))
    .sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
      return a.contact!.username.localeCompare(b.contact!.username)
    })

  const confirmRemove = async () => {
    if (!removing) return
    setRemovingBusy(true)
    const { error: rpcErr } = await supabase.rpc('remove_contact', {
      p_contact_user_id: removing.contact_user_id,
    })
    setRemovingBusy(false)
    setRemoving(null)
    if (rpcErr) {
      setAddError(rpcErr.message)
      return
    }
    refetch()
  }

  const respondRequest = async (req: ContactRequest, accept: boolean) => {
    setRespondingId(req.id)
    const { error: rpcErr } = await supabase.rpc('respond_contact_request', {
      p_request_id: req.id,
      p_accept: accept,
    })
    setRespondingId(null)
    if (rpcErr) {
      setAddError(rpcErr.message)
      return
    }
    refetch()
  }

  const cancelRequest = async (req: ContactRequest) => {
    setCancellingId(req.id)
    const { error: rpcErr } = await supabase.rpc('cancel_contact_request', { p_request_id: req.id })
    setCancellingId(null)
    if (rpcErr) {
      setAddError(rpcErr.message)
      return
    }
    refetch()
  }

  const handleAddSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setAddError(null)
    setAddSuccess(null)
    const value = addEmail.trim().toLowerCase()
    if (!value || !user) return

    if (value === user.email?.toLowerCase()) {
      setAddError(t('contacts.errorSelf'))
      return
    }

    setAddSubmitting(true)

    const { data: profile, error: findErr } = await supabase
      .from('profiles')
      .select('*')
      .ilike('email', value)
      .maybeSingle()

    if (findErr) {
      setAddSubmitting(false)
      setAddError(findErr.message)
      return
    }
    if (!profile) {
      setAddSubmitting(false)
      setAddError(t('contacts.errorNotFound'))
      return
    }

    const { error: rpcErr } = await supabase.rpc('send_contact_request', { p_to_user_id: profile.id })
    setAddSubmitting(false)
    if (rpcErr) {
      if (rpcErr.message.includes('ALREADY_CONTACT')) setAddError(t('contacts.errorAlreadyContact'))
      else if (rpcErr.message.includes('SELF_REQUEST')) setAddError(t('contacts.errorSelf'))
      else if (rpcErr.message.includes('BLOCKED')) setAddError(t('contacts.errorBlocked'))
      else if (rpcErr.code === '23505') setAddError(t('contacts.errorPendingExists'))
      else setAddError(rpcErr.message)
      return
    }

    setAddSuccess(t('contacts.requestSent', { name: profile.username }))
    setAddEmail('')
    refetch()
  }

  const hasPending = incoming.length > 0 || outgoing.length > 0

  return (
    <div
      className="min-h-screen pb-28 bg-[var(--color-surface-alt)]"
      style={profile?.background_color ? { backgroundColor: profile.background_color } : undefined}
    >
      <header className="sticky top-0 z-10 bg-[var(--color-surface)] px-4 py-4 shadow-sm">
        <h1 className="mx-auto max-w-2xl text-lg font-semibold text-slate-900 dark:text-slate-100">
          {t('nav.tabContacts')}
        </h1>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-6">
        {loadError && (
          <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/40 dark:text-red-400">
            {loadError}
          </p>
        )}
        {addError && (
          <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/40 dark:text-red-400">
            {addError}
          </p>
        )}

        {hasPending && (
          <section className="mb-8">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              {t('contacts.pendingTitle')}
            </h2>
            <div className="space-y-3">
              {incoming.map((req) => (
                <div
                  key={req.id}
                  className="flex items-center justify-between gap-3 rounded-xl bg-amber-50 p-4 ring-1 ring-amber-200 dark:bg-amber-950/40 dark:ring-amber-900"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar
                      username={req.from_profile?.username ?? '?'}
                      avatarUrl={req.from_profile?.avatar_url ?? null}
                      size={36}
                      enlargeOnClick={false}
                    />
                    <div className="min-w-0">
                      <p className="truncate font-medium text-slate-900 dark:text-slate-100">
                        {req.from_profile?.username}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">{t('contacts.requestedYou')}</p>
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      onClick={() => respondRequest(req, false)}
                      disabled={respondingId === req.id}
                      className="rounded-lg border px-3 py-1.5 text-sm text-slate-600 hover:bg-white disabled:opacity-60 border-[var(--color-surface-border)] dark:text-slate-300 dark:hover:bg-slate-700"
                    >
                      {t('lists.reject')}
                    </button>
                    <button
                      onClick={() => respondRequest(req, true)}
                      disabled={respondingId === req.id}
                      className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
                    >
                      {t('lists.accept')}
                    </button>
                  </div>
                </div>
              ))}

              {outgoing.map((req) => (
                <div
                  key={req.id}
                  className="flex items-center justify-between gap-3 rounded-xl p-4 ring-1 bg-[var(--color-surface)] ring-[var(--color-surface-border)]"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar
                      username={req.to_profile?.username ?? '?'}
                      avatarUrl={req.to_profile?.avatar_url ?? null}
                      size={36}
                      enlargeOnClick={false}
                    />
                    <div className="min-w-0">
                      <p className="truncate font-medium text-slate-900 dark:text-slate-100">
                        {req.to_profile?.username}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {t('contacts.outgoingPending', { name: req.to_profile?.username ?? '' })}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => cancelRequest(req)}
                    disabled={cancellingId === req.id}
                    className="shrink-0 rounded-lg border px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-60 border-[var(--color-surface-border)] dark:text-slate-300 dark:hover:bg-slate-700"
                  >
                    {cancellingId === req.id ? t('contacts.cancelling') : t('contacts.cancelRequest')}
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="mb-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            {t('contacts.addTitle')}
          </h2>
          <div className="rounded-xl p-4 shadow-sm ring-1 bg-[var(--color-surface)] ring-[var(--color-surface-border)]">
            <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">{t('contacts.addBody')}</p>
            {addSuccess && (
              <p className="mb-3 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700 dark:bg-green-950/40 dark:text-green-400">
                {addSuccess}
              </p>
            )}
            <form onSubmit={handleAddSubmit} className="flex gap-2">
              <input
                type="email"
                value={addEmail}
                onChange={(e) => setAddEmail(e.target.value)}
                placeholder={t('contacts.addPlaceholder')}
                className="min-w-0 flex-1 rounded-lg border px-3 py-2.5 text-base focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 border-[var(--color-surface-border)] bg-[var(--color-surface-alt)] dark:text-slate-100"
              />
              <button
                type="submit"
                disabled={addSubmitting}
                className="shrink-0 rounded-lg bg-brand-600 px-4 py-2.5 font-medium text-white hover:bg-brand-700 disabled:opacity-60"
              >
                {addSubmitting ? t('contacts.sendingRequest') : t('contacts.addSubmit')}
              </button>
            </form>
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            {t('contacts.yourContactsTitle')}
          </h2>

          {!loading && contacts.length > 0 && (
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('invite.searchContacts')}
              className="mb-3 w-full rounded-lg border px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 border-[var(--color-surface-border)] bg-[var(--color-surface-alt)] dark:text-slate-100"
            />
          )}

          <div className="rounded-xl shadow-sm ring-1 bg-[var(--color-surface)] ring-[var(--color-surface-border)]">
            {loading ? (
              <p className="py-8 text-center text-sm text-slate-400">{t('common.loading')}</p>
            ) : contacts.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-slate-400">{t('contacts.empty')}</p>
            ) : visibleContacts.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-slate-400">{t('invite.noContactsMatch')}</p>
            ) : (
              <ul className="divide-y divide-[var(--color-surface-border)]">
                {visibleContacts.map((c) => (
                  <li key={c.contact_user_id}>
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => setCardTarget(c.contact!)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') setCardTarget(c.contact!)
                      }}
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-white/5"
                    >
                      <Avatar
                        username={c.contact!.username}
                        avatarUrl={c.contact!.avatar_url}
                        size={36}
                        enlargeOnClick={false}
                      />
                      <span className="flex-1 truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                        {c.pinned && <span className="mr-1">📌</span>}
                        {c.contact!.username}
                        {isCurrentlyMuted(c.muted, c.muted_until) && (
                          <span className="ml-1 align-middle text-xs text-slate-400">🔕</span>
                        )}
                        {c.blocked_at && (
                          <span className="ml-1 align-middle text-xs text-slate-400" title={t('contacts.blockedBadge')}>
                            🚫
                          </span>
                        )}
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          navigate(`/contacts/${c.contact_user_id}/chat`)
                        }}
                        aria-label={t('card.openChat')}
                        title={t('card.openChat')}
                        className="shrink-0 rounded-full p-1.5 text-slate-400 hover:bg-brand-50 hover:text-brand-600 dark:hover:bg-brand-950/40 dark:hover:text-brand-400"
                      >
                        💬
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          setRemoving(c)
                        }}
                        aria-label={t('contacts.remove')}
                        title={t('contacts.remove')}
                        className="shrink-0 rounded-full p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                      >
                        🗑
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </main>

      {removing && (
        <ConfirmDialog
          title={t('contacts.removeTitle')}
          message={t('contacts.removeConfirm', { name: removing.contact!.username })}
          confirmLabel={removingBusy ? t('contacts.removing') : t('contacts.remove')}
          danger
          onCancel={() => setRemoving(null)}
          onConfirm={confirmRemove}
        />
      )}

      {cardTarget && (
        <ContactCardSheet targetProfile={cardTarget} onClose={() => setCardTarget(null)} onChanged={refetch} />
      )}
    </div>
  )
}
