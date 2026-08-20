import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../lib/i18n'
import { useNoteDetail } from '../hooks/useNoteDetail'
import { supabase } from '../lib/supabaseClient'
import InviteNoteMemberModal from '../components/InviteNoteMemberModal'
import ConfirmDialog from '../components/ConfirmDialog'
import Avatar from '../components/Avatar'

const AUTOSAVE_DELAY_MS = 800

export default function NoteDetailPage() {
  const { noteId } = useParams<{ noteId: string }>()
  const { user, profile } = useAuth()
  const { t } = useLanguage()
  const navigate = useNavigate()
  const { note, members, isOwner, loading, error, refetch, updateNote } = useNoteDetail(noteId)

  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [showMembers, setShowMembers] = useState(false)
  const [showInvite, setShowInvite] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState<{ userId: string; username: string } | null>(null)

  // Mientras la persona tiene el campo enfocado (escribiendo), no le
  // pisamos lo que está tecleando con lo que llegue de la base de datos
  // (ni lo suyo propio reflejado, ni un cambio de otro miembro) — solo se
  // actualiza el campo local cuando NO lo tiene activo.
  const titleFocusedRef = useRef(false)
  const bodyFocusedRef = useRef(false)
  const titleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const bodyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (note && !titleFocusedRef.current) setTitle(note.title)
  }, [note?.title, note])

  useEffect(() => {
    if (note && !bodyFocusedRef.current) setBody(note.body)
  }, [note?.body, note])

  useEffect(() => {
    return () => {
      if (titleTimerRef.current) clearTimeout(titleTimerRef.current)
      if (bodyTimerRef.current) clearTimeout(bodyTimerRef.current)
    }
  }, [])

  const scheduleSave = (patch: { title?: string; body?: string }, timerRef: typeof titleTimerRef) => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      updateNote(patch)
    }, AUTOSAVE_DELAY_MS)
  }

  const handleTitleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setTitle(value)
    scheduleSave({ title: value }, titleTimerRef)
  }

  const handleBodyChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value
    setBody(value)
    scheduleSave({ body: value }, bodyTimerRef)
  }

  const removeMember = async () => {
    if (!confirmRemove || !noteId) return
    await supabase.from('note_members').delete().eq('note_id', noteId).eq('user_id', confirmRemove.userId)
    setConfirmRemove(null)
    refetch()
  }

  const existingMemberIds = members.map((m) => m.user_id)
  const acceptedMembers = members.filter((m) => m.status === 'accepted')

  if (!noteId) return null

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--color-surface-alt)]">
        <p className="text-slate-400">{t('list.loading')}</p>
      </div>
    )
  }

  if (error || !note) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-4 text-center bg-[var(--color-surface-alt)]">
        <p className="text-slate-600 dark:text-slate-300">{t('list.errorLoad')}</p>
        <button onClick={() => navigate('/notes')} className="text-brand-600 underline dark:text-brand-400">
          {t('apuntes.tabTitle')}
        </button>
      </div>
    )
  }

  return (
    <div
      className="min-h-screen bg-[var(--color-surface-alt)]"
      style={profile?.background_color ? { backgroundColor: profile.background_color } : undefined}
    >
      <header className="sticky top-0 z-10 border-b bg-gradient-to-r from-white to-brand-50/50 px-4 py-3 backdrop-blur border-[var(--color-surface-border)] dark:from-[var(--color-surface)] dark:to-[var(--color-surface)]">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-2">
          <button
            onClick={() => navigate('/notes')}
            className="shrink-0 text-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
          >
            ‹
          </button>
          <div className="min-w-0 flex-1">
            <button
              onClick={() => setShowMembers((s) => !s)}
              className="block text-xs text-slate-400 hover:text-brand-600 dark:hover:text-brand-400"
            >
              {acceptedMembers.length} {acceptedMembers.length === 1 ? t('list.member') : t('list.membersPlural')}
            </button>
          </div>
          {isOwner && (
            <button
              onClick={() => setShowInvite(true)}
              className="shrink-0 rounded-lg border border-brand-300 px-3 py-1.5 text-sm font-medium text-brand-700 hover:bg-brand-50 dark:border-transparent dark:bg-brand-600 dark:text-white dark:hover:bg-brand-700"
            >
              {t('list.inviteButton')}
            </button>
          )}
        </div>

        {showMembers && (
          <div className="mx-auto mt-3 max-w-2xl rounded-lg p-3 text-sm bg-[var(--color-surface)]">
            <ul className="space-y-2">
              {members.map((m) => {
                const isSelf = m.user_id === user?.id
                return (
                  <li key={m.user_id} className="flex items-center justify-between">
                    <span className="flex items-center gap-2 text-slate-700 dark:text-slate-200">
                      <Avatar username={m.profile?.username ?? '?'} avatarUrl={m.profile?.avatar_url} size={24} enlargeOnClick={false} />
                      {m.profile?.username ?? m.user_id}
                      {isSelf ? ` ${t('expenses.you')}` : ''}
                      {m.role === 'owner' ? t('list.ownerSuffix') : ''}
                    </span>
                    <span className="flex items-center gap-2">
                      <span className={`text-xs ${m.status === 'accepted' ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400'}`}>
                        {m.status === 'accepted' ? t('member.statusActive') : t('member.statusPending')}
                      </span>
                      {isOwner && m.role !== 'owner' && (
                        <button
                          onClick={() => setConfirmRemove({ userId: m.user_id, username: m.profile?.username ?? t('list.thisUser') })}
                          className="rounded p-1 text-slate-300 hover:bg-red-50 hover:text-red-500 dark:text-slate-500 dark:hover:bg-red-950/40"
                          aria-label={t('list.removeMember')}
                          title={t('list.removeMember')}
                        >
                          🗑
                        </button>
                      )}
                    </span>
                  </li>
                )
              })}
            </ul>
          </div>
        )}
      </header>

      <main className="mx-auto max-w-2xl px-4 py-5">
        <input
          type="text"
          value={title}
          onChange={handleTitleChange}
          onFocus={() => (titleFocusedRef.current = true)}
          onBlur={() => {
            titleFocusedRef.current = false
          }}
          placeholder={t('apuntes.titlePlaceholder')}
          className="mb-3 w-full border-0 border-b bg-transparent px-0 pb-2 text-xl font-bold text-slate-900 focus:outline-none focus:ring-0 border-[var(--color-surface-border)] dark:text-slate-100"
        />
        <textarea
          value={body}
          onChange={handleBodyChange}
          onFocus={() => (bodyFocusedRef.current = true)}
          onBlur={() => {
            bodyFocusedRef.current = false
          }}
          placeholder={t('apuntes.bodyPlaceholder')}
          rows={16}
          className="w-full resize-none rounded-lg border-0 bg-transparent px-0 text-base leading-relaxed text-slate-800 focus:outline-none focus:ring-0 dark:text-slate-100"
        />
      </main>

      {showInvite && (
        <InviteNoteMemberModal
          noteId={noteId}
          existingMemberIds={existingMemberIds}
          onClose={() => setShowInvite(false)}
          onInvited={refetch}
        />
      )}

      {confirmRemove && (
        <ConfirmDialog
          title={t('list.removeMember')}
          message={t('list.removeMemberConfirm', { name: confirmRemove.username })}
          confirmLabel={t('menu.delete')}
          danger
          onConfirm={removeMember}
          onCancel={() => setConfirmRemove(null)}
        />
      )}
    </div>
  )
}
