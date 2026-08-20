import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../lib/i18n'
import Avatar from './Avatar'
import type { Contact } from '../lib/types'

// Copia adaptada de InviteMemberModal.tsx (list_members -> note_members) en
// vez de generalizar ese componente — así no se arriesga a romper el flujo
// de invitar a una lista, que ya funciona, mientras se monta esto nuevo.
export default function InviteNoteMemberModal({
  noteId,
  existingMemberIds,
  onClose,
  onInvited,
}: {
  noteId: string
  existingMemberIds: string[]
  onClose: () => void
  onInvited: () => void
}) {
  const { user } = useAuth()
  const { t } = useLanguage()
  const [contacts, setContacts] = useState<Contact[]>([])
  const [loadingContacts, setLoadingContacts] = useState(true)
  const [contactSearch, setContactSearch] = useState('')
  const [addingContactId, setAddingContactId] = useState<string | null>(null)

  const [identifier, setIdentifier] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  useEffect(() => {
    if (!user) return
    let cancelled = false
    supabase
      .from('contacts')
      .select('*, contact:profiles!contacts_contact_user_id_fkey(*)')
      .eq('user_id', user.id)
      .then(({ data }) => {
        if (!cancelled) {
          setContacts((data as unknown as Contact[]) ?? [])
          setLoadingContacts(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [user])

  const existingIds = useMemo(() => new Set(existingMemberIds), [existingMemberIds])
  const normalizedSearch = contactSearch.trim().toLowerCase()
  const availableContacts = contacts
    .filter((c) => c.contact && !existingIds.has(c.contact.id))
    .filter((c) => !normalizedSearch || c.contact!.username.toLowerCase().includes(normalizedSearch))
    .sort((a, b) => a.contact!.username.localeCompare(b.contact!.username))

  const inviteContact = async (contact: Contact) => {
    if (!user || !contact.contact) return
    setAddingContactId(contact.contact_user_id)
    setError(null)
    setSuccess(null)
    const { error: insertErr } = await supabase.from('note_members').insert({
      note_id: noteId,
      user_id: contact.contact_user_id,
      role: 'member',
      status: 'invited',
      invited_identifier: contact.contact.email,
      invited_by: user.id,
    })
    setAddingContactId(null)
    if (insertErr) {
      setError(
        insertErr.code === '23505'
          ? t('invite.errorAlreadyMember')
          : insertErr.code === '42501'
            ? t('invite.errorBlocked')
            : insertErr.message,
      )
      return
    }
    setSuccess(t('invite.successSent', { name: contact.contact.username }))
    onInvited()
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setSuccess(null)
    const value = identifier.trim().toLowerCase()
    if (!value || !user) return
    setSubmitting(true)

    const { data: profile, error: findErr } = await supabase
      .from('profiles')
      .select('*')
      .ilike('email', value)
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

    const { error: insertErr } = await supabase.from('note_members').insert({
      note_id: noteId,
      user_id: profile.id,
      role: 'member',
      status: 'invited',
      invited_identifier: value,
      invited_by: user.id,
    })

    setSubmitting(false)
    if (insertErr) {
      if (insertErr.code === '23505') {
        setError(t('invite.errorAlreadyMember'))
      } else if (insertErr.code === '42501') {
        setError(t('invite.errorBlocked'))
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
        className="flex max-h-[88vh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl shadow-xl sm:rounded-2xl bg-[var(--color-surface)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 p-6 pb-0">
          <h2 className="mb-1 text-lg font-semibold text-slate-900 dark:text-slate-100">{t('apuntes.inviteTitle')}</h2>

          {error && (
            <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/40 dark:text-red-400">
              {error}
            </p>
          )}
          {success && (
            <p className="mb-3 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700 dark:bg-green-950/40 dark:text-green-400">
              {success}
            </p>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6">
          {!loadingContacts && contacts.length > 0 && (
            <div className="mb-5">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                {t('invite.yourContacts')}
              </p>
              <input
                type="text"
                value={contactSearch}
                onChange={(e) => setContactSearch(e.target.value)}
                placeholder={t('invite.searchContacts')}
                className="mb-2 w-full rounded-lg border px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 border-[var(--color-surface-border)] bg-[var(--color-surface-alt)] dark:text-slate-100"
              />
              {availableContacts.length === 0 ? (
                <p className="py-3 text-center text-sm text-slate-400">
                  {normalizedSearch ? t('invite.noContactsMatch') : t('invite.allContactsInList')}
                </p>
              ) : (
                <ul className="divide-y divide-[var(--color-surface-border)]">
                  {availableContacts.map((c) => (
                    <li key={c.contact_user_id} className="flex items-center gap-3 py-2">
                      <Avatar username={c.contact!.username} avatarUrl={c.contact!.avatar_url} size={32} enlargeOnClick={false} />
                      <span className="flex-1 truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                        {c.contact!.username}
                      </span>
                      <button
                        type="button"
                        onClick={() => inviteContact(c)}
                        disabled={addingContactId === c.contact_user_id}
                        className="shrink-0 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
                      >
                        {addingContactId === c.contact_user_id ? t('invite.inviting') : t('invite.addContact')}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className={contacts.length > 0 ? 'border-t pt-4 border-[var(--color-surface-border)]' : ''}>
            <p className="mb-2 text-sm text-slate-500 dark:text-slate-400">
              {contacts.length > 0 ? t('invite.orByEmail') : t('invite.body')}
            </p>
            <form onSubmit={handleSubmit} className="flex gap-2">
              <input
                type="email"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder={t('invite.placeholder')}
                className="min-w-0 flex-1 rounded-lg border px-3 py-2.5 text-base focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 border-[var(--color-surface-border)] bg-[var(--color-surface-alt)] dark:text-slate-100"
              />
              <button
                type="submit"
                disabled={submitting}
                className="shrink-0 rounded-lg bg-brand-600 px-4 py-2.5 font-medium text-white hover:bg-brand-700 disabled:opacity-60"
              >
                {submitting ? t('invite.inviting') : t('invite.submit')}
              </button>
            </form>
          </div>
        </div>

        <div className="shrink-0 p-6 pt-4">
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-lg border px-4 py-2.5 font-medium text-slate-700 hover:bg-slate-50 border-[var(--color-surface-border)] dark:text-slate-200 dark:hover:bg-slate-700"
          >
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  )
}
