import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../lib/i18n'
import { looksLikePhone, normalizePhone } from '../lib/phone'
import Avatar from './Avatar'
import type { Contact } from '../lib/types'

export default function InviteMemberModal({
  listId,
  existingMemberIds,
  onClose,
  onInvited,
}: {
  listId: string
  // Ids de quien ya está en la lista (miembro o con invitación pendiente) —
  // para no ofrecerlos otra vez en la lista de contactos. Ver
  // ListDetailPage.tsx.
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
  const [shareFeedback, setShareFeedback] = useState<string | null>(null)

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

  const shareApp = async () => {
    const text = t('invite.shareText')
    const url = window.location.origin
    if (navigator.share) {
      try {
        await navigator.share({ title: 'NoteUs', text, url })
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

  const inviteContact = async (contact: Contact) => {
    if (!user || !contact.contact) return
    setAddingContactId(contact.contact_user_id)
    setError(null)
    setSuccess(null)
    const { error: insertErr } = await supabase.from('list_members').insert({
      list_id: listId,
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
    const rawValue = identifier.trim()
    if (!rawValue || !user) return
    setSubmitting(true)

    // Ya no se busca por nombre de usuario (dos personas pueden tener el
    // mismo, y buscar entre TODOS los usuarios registrados era ambiguo y
    // poco fiable) — la primera vez que invitas a alguien nuevo tiene que
    // ser por su email o su teléfono, que sí son únicos. Detectamos cuál de
    // los dos es (ver looksLikePhone en lib/phone.ts) para buscar en la
    // columna que toca. "ilike" sin comodines (%) compara el email
    // ignorando mayúsculas/minúsculas; el teléfono se compara ya
    // normalizado (ver migration_v35.sql).
    const isPhone = looksLikePhone(rawValue)
    const value = isPhone ? normalizePhone(rawValue) : rawValue.toLowerCase()
    const query = supabase.from('profiles').select('*')
    const { data: profile, error: findErr } = await (isPhone
      ? query.eq('phone', value)
      : query.ilike('email', value)
    ).maybeSingle()

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
        className="glass-panel flex max-h-[88vh] w-full max-w-md flex-col overflow-hidden rounded-t-[28px] shadow-[0_24px_60px_-20px_rgba(20,21,26,0.5)] sm:rounded-[28px]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 p-6 pb-0">
          <h2 className="mb-1 text-lg font-semibold text-slate-900 dark:text-slate-100">{t('invite.title')}</h2>

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
                className="mb-2 w-full rounded-2xl border px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 border-[var(--color-glass-border)] bg-[var(--color-glass)] dark:text-slate-100"
              />
              {availableContacts.length === 0 ? (
                <p className="py-3 text-center text-sm text-slate-400">
                  {normalizedSearch ? t('invite.noContactsMatch') : t('invite.allContactsAdded')}
                </p>
              ) : (
                <ul className="divide-y divide-[var(--color-glass-border)]">
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
                        className="shrink-0 rounded-full bg-gradient-to-br from-[var(--color-brand-500)] to-[var(--color-brand-600)] px-3 py-1.5 text-xs font-semibold text-white shadow-[0_10px_22px_-10px_var(--color-glow)] disabled:opacity-60"
                      >
                        {addingContactId === c.contact_user_id ? t('invite.inviting') : t('invite.addContact')}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className={contacts.length > 0 ? 'border-t pt-4 border-[var(--color-glass-border)]' : ''}>
            <p className="mb-2 text-sm text-slate-500 dark:text-slate-400">
              {contacts.length > 0 ? t('invite.orByEmail') : t('invite.body')}
            </p>
            <form onSubmit={handleSubmit} className="flex gap-2">
              <input
                type="text"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder={t('invite.placeholder')}
                className="min-w-0 flex-1 rounded-2xl border px-3 py-2.5 text-base focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 border-[var(--color-glass-border)] bg-[var(--color-glass)] dark:text-slate-100"
              />
              <button
                type="submit"
                disabled={submitting}
                className="shrink-0 rounded-full bg-gradient-to-br from-[var(--color-brand-500)] to-[var(--color-brand-600)] px-4 py-2.5 font-medium text-white shadow-[0_10px_22px_-10px_var(--color-glow)] disabled:opacity-60"
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
            className="w-full rounded-full border px-4 py-2.5 font-medium text-slate-700 hover:bg-white/60 border-[var(--color-glass-border)] dark:text-slate-200 dark:hover:bg-white/10"
          >
            {t('common.close')}
          </button>

          <div className="mt-4 border-t border-[var(--color-glass-border)] pt-4 text-center">
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
    </div>
  )
}
