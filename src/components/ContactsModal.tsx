import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../lib/i18n'
import Avatar from './Avatar'
import ConfirmDialog from './ConfirmDialog'
import type { Contact } from '../lib/types'

export default function ContactsModal({ onClose }: { onClose: () => void }) {
  const { user } = useAuth()
  const { t } = useLanguage()
  const [contacts, setContacts] = useState<Contact[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [removing, setRemoving] = useState<Contact | null>(null)
  const [removingBusy, setRemovingBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    if (!user) return
    setLoading(true)
    const { data, error: fetchErr } = await supabase
      .from('contacts')
      .select('*, contact:profiles!contacts_contact_user_id_fkey(*)')
      .eq('user_id', user.id)
    if (fetchErr) setError(fetchErr.message)
    setContacts((data as unknown as Contact[]) ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  const normalizedSearch = search.trim().toLowerCase()
  const visibleContacts = contacts
    .filter((c) => c.contact)
    .filter((c) => !normalizedSearch || c.contact!.username.toLowerCase().includes(normalizedSearch))
    .sort((a, b) => a.contact!.username.localeCompare(b.contact!.username))

  const confirmRemove = async () => {
    if (!removing) return
    setRemovingBusy(true)
    const { error: rpcErr } = await supabase.rpc('remove_contact', {
      p_contact_user_id: removing.contact_user_id,
    })
    setRemovingBusy(false)
    setRemoving(null)
    if (rpcErr) {
      setError(rpcErr.message)
      return
    }
    setContacts((prev) => prev.filter((c) => c.contact_user_id !== removing.contact_user_id))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl shadow-xl sm:rounded-2xl bg-[var(--color-surface)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 p-6 pb-3">
          <h2 className="mb-1 text-lg font-semibold text-slate-900 dark:text-slate-100">{t('contacts.title')}</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">{t('contacts.body')}</p>
        </div>

        {error && (
          <p className="mx-6 mb-3 shrink-0 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/40 dark:text-red-400">
            {error}
          </p>
        )}

        {!loading && contacts.length > 0 && (
          <div className="shrink-0 px-6 pb-3">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('invite.searchContacts')}
              className="w-full rounded-lg border px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 border-[var(--color-surface-border)] bg-[var(--color-surface-alt)] dark:text-slate-100"
            />
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-4">
          {loading ? (
            <p className="py-8 text-center text-sm text-slate-400">{t('common.loading')}</p>
          ) : contacts.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">{t('contacts.empty')}</p>
          ) : visibleContacts.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">{t('invite.noContactsMatch')}</p>
          ) : (
            <ul className="divide-y divide-[var(--color-surface-border)]">
              {visibleContacts.map((c) => (
                <li key={c.contact_user_id} className="flex items-center gap-3 py-2.5">
                  <Avatar username={c.contact!.username} avatarUrl={c.contact!.avatar_url} size={36} enlargeOnClick={false} />
                  <span className="flex-1 truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                    {c.contact!.username}
                  </span>
                  <button
                    type="button"
                    onClick={() => setRemoving(c)}
                    aria-label={t('contacts.remove')}
                    title={t('contacts.remove')}
                    className="shrink-0 rounded-full p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                  >
                    🗑
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="shrink-0 p-6 pt-3">
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-lg border px-4 py-2.5 font-medium text-slate-700 hover:bg-slate-50 border-[var(--color-surface-border)] dark:text-slate-200 dark:hover:bg-slate-700"
          >
            {t('common.close')}
          </button>
        </div>
      </div>

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
    </div>
  )
}
