import { useMemo, useState, type MouseEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../lib/i18n'
import { useNotes } from '../hooks/useNotes'
import { supabase } from '../lib/supabaseClient'
import CreateNoteModal from '../components/CreateNoteModal'
import ConfirmDialog from '../components/ConfirmDialog'

// Pantalla de "Notas comunes" (ver migration_v23.sql) — algo aparte de las
// listas, con su propia pestaña en la barra inferior. Versión simple a
// propósito (sin fijar/reordenar/archivar, que sí tiene "Mis listas") para
// poder dejarla lista hoy; se puede ampliar después si hace falta.
export default function NotesPage() {
  const { profile } = useAuth()
  const { t } = useLanguage()
  const { notes, invitations, loading, error, refetch } = useNotes()
  const [showCreate, setShowCreate] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [actionError, setActionError] = useState<string | null>(null)
  const [confirmTarget, setConfirmTarget] = useState<{ noteId: string; title: string; isOwner: boolean } | null>(
    null,
  )
  const [pendingDeleteIds, setPendingDeleteIds] = useState<Set<string>>(new Set())
  const navigate = useNavigate()

  const normalizedQuery = searchQuery.trim().toLowerCase()
  const visibleNotes = useMemo(() => {
    const base = notes.filter((n) => !pendingDeleteIds.has(n.id))
    return normalizedQuery ? base.filter((n) => n.title.toLowerCase().includes(normalizedQuery)) : base
  }, [notes, pendingDeleteIds, normalizedQuery])

  const respondInvitation = async (noteId: string, accept: boolean) => {
    if (accept) {
      await supabase
        .from('note_members')
        .update({ status: 'accepted', responded_at: new Date().toISOString() })
        .eq('note_id', noteId)
        .eq('user_id', profile!.id)
    } else {
      await supabase.from('note_members').delete().eq('note_id', noteId).eq('user_id', profile!.id)
    }
    refetch()
  }

  const requestDeleteOrLeave = (e: MouseEvent, noteId: string, title: string, isOwner: boolean) => {
    e.stopPropagation()
    setActionError(null)
    setConfirmTarget({ noteId, title, isOwner })
  }

  const confirmDeleteOrLeave = async () => {
    if (!confirmTarget) return
    const { noteId, isOwner } = confirmTarget
    setConfirmTarget(null)
    setPendingDeleteIds((prev) => new Set(prev).add(noteId))
    const { error: err } = isOwner
      ? await supabase.from('notes').delete().eq('id', noteId)
      : await supabase.from('note_members').delete().eq('note_id', noteId).eq('user_id', profile!.id)
    if (err) {
      setPendingDeleteIds((prev) => {
        const next = new Set(prev)
        next.delete(noteId)
        return next
      })
      setActionError(err.message)
      return
    }
    refetch()
  }

  return (
    <div className="min-h-screen pb-32">
      <header className="glass-panel sticky top-3 z-10 mx-3 rounded-[26px] px-4 pb-4 pt-3.5 shadow-[0_16px_36px_-24px_rgba(20,21,26,0.35)]">
        <div className="mx-auto flex max-w-2xl items-center justify-between">
          <h1 className="font-display font-medium text-slate-900 dark:text-slate-100">{t('apuntes.tabTitle')}</h1>
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="rounded-full bg-gradient-to-br from-[var(--color-brand-500)] to-[var(--color-brand-600)] px-3 py-1.5 text-sm font-medium text-white shadow-[0_8px_18px_-8px_var(--color-glow)]"
          >
            + {t('apuntes.createShort')}
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-4">
        {error && (
          <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/40 dark:text-red-400">
            {error}
          </p>
        )}
        {actionError && (
          <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/40 dark:text-red-400">
            {actionError}
          </p>
        )}

        {invitations.length > 0 && (
          <section className="mb-6">
            <h2 className="mb-3 font-mono text-xs uppercase tracking-wide text-[var(--color-brand-600)]">
              {t('apuntes.pendingTitle')}
            </h2>
            <div className="space-y-2">
              {invitations.map((inv) => (
                <div
                  key={inv.id}
                  className="glass-panel flex items-center justify-between gap-2 rounded-2xl p-3"
                >
                  <p className="min-w-0 flex-1 truncate font-medium text-slate-800 dark:text-slate-100">
                    {inv.title}
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => respondInvitation(inv.id, false)}
                      className="rounded-full border px-3 py-1.5 text-sm text-slate-600 border-[var(--color-glass-border)] dark:text-slate-300"
                    >
                      {t('lists.reject')}
                    </button>
                    <button
                      onClick={() => respondInvitation(inv.id, true)}
                      className="rounded-full bg-gradient-to-br from-[var(--color-brand-500)] to-[var(--color-brand-600)] px-3 py-1.5 text-sm font-medium text-white shadow-[0_8px_18px_-8px_var(--color-glow)]"
                    >
                      {t('lists.accept')}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        <section>
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="font-mono text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
              {t('apuntes.tabTitle')}
            </h2>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('lists.searchPlaceholder')}
              aria-label={t('common.search')}
              className="w-36 rounded-full border px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 border-[var(--color-glass-border)] bg-[var(--color-glass)] dark:text-slate-100"
            />
          </div>

          {loading ? (
            <p className="py-6 text-center text-sm text-slate-400">{t('list.loading')}</p>
          ) : visibleNotes.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-400">
              {normalizedQuery ? t('lists.emptySearch') : t('apuntes.empty')}
            </p>
          ) : (
            <ul className="space-y-2">
              {visibleNotes.map((n) => {
                const isOwner = n.owner_id === profile?.id
                const snippet = n.body.trim().slice(0, 80)
                return (
                  <li key={n.id}>
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => navigate(`/notes/${n.id}`)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') navigate(`/notes/${n.id}`)
                      }}
                      className="glass-panel flex w-full items-start gap-3 rounded-2xl p-3.5 text-left transition"
                    >
                      <span className="mt-0.5 shrink-0 text-xl">📝</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold text-slate-900 dark:text-slate-100">
                          {n.title}
                        </span>
                        {snippet && (
                          <span className="block truncate text-sm text-slate-500 dark:text-slate-400">
                            {snippet}
                          </span>
                        )}
                      </span>
                      <button
                        type="button"
                        onClick={(e) => requestDeleteOrLeave(e, n.id, n.title, isOwner)}
                        aria-label={isOwner ? t('apuntes.deleteNote') : t('apuntes.leaveNote')}
                        title={isOwner ? t('apuntes.deleteNote') : t('apuntes.leaveNote')}
                        className="shrink-0 rounded-full p-1.5 text-slate-300 hover:bg-red-50 hover:text-red-500 dark:text-slate-500 dark:hover:bg-red-950/40"
                      >
                        🗑
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </main>

      {showCreate && (
        <CreateNoteModal
          onClose={() => setShowCreate(false)}
          onCreated={(noteId) => {
            setShowCreate(false)
            refetch()
            navigate(`/notes/${noteId}`)
          }}
        />
      )}

      {confirmTarget && (
        <ConfirmDialog
          title={confirmTarget.isOwner ? t('apuntes.deleteTitle') : t('apuntes.leaveTitle')}
          message={confirmTarget.isOwner ? t('apuntes.deleteConfirm') : t('apuntes.leaveConfirm')}
          confirmLabel={confirmTarget.isOwner ? t('menu.delete') : t('apuntes.leaveNote')}
          danger
          onConfirm={confirmDeleteOrLeave}
          onCancel={() => setConfirmTarget(null)}
        />
      )}
    </div>
  )
}
