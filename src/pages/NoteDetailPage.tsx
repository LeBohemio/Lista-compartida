import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../lib/i18n'
import { useNoteDetail } from '../hooks/useNoteDetail'
import { supabase } from '../lib/supabaseClient'
import InviteNoteMemberModal from '../components/InviteNoteMemberModal'
import ConfirmDialog from '../components/ConfirmDialog'
import Avatar from '../components/Avatar'
import { TrashIcon } from '../components/icons'

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
  // Sustituye a la idea de mostrar "editado hace X" (no guardamos quién ni
  // cuándo se tocó por última vez el título/cuerpo por separado, solo
  // last_activity_at general) por algo más simple y sincero: un indicador
  // de guardado en vivo, con las cadenas 'apuntes.saving'/'apuntes.saved'
  // que ya existían en las traducciones pero no se usaban en ningún sitio.
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const titleAreaRef = useRef<HTMLTextAreaElement>(null)

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
    setSaveStatus('saving')
    timerRef.current = setTimeout(async () => {
      await updateNote(patch)
      setSaveStatus('saved')
    }, AUTOSAVE_DELAY_MS)
  }

  // El título ahora es un <textarea> de una sola fila que crece con el
  // contenido (igual que el compositor del chat) en vez de un <input> de
  // toda la vida — un título largo se veía cortado a la mitad, sin forma
  // de leerlo entero, porque un <input> nunca hace salto de línea.
  useEffect(() => {
    const el = titleAreaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [title])

  const handleTitleChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
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
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-slate-400">{t('list.loading')}</p>
      </div>
    )
  }

  if (error || !note) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-4 text-center">
        <p className="text-slate-600 dark:text-slate-300">{t('list.errorLoad')}</p>
        <button onClick={() => navigate('/notes')} className="text-brand-600 underline dark:text-brand-400">
          {t('apuntes.tabTitle')}
        </button>
      </div>
    )
  }

  return (
    <div
      className="min-h-screen"
      style={profile?.background_color ? { backgroundColor: profile.background_color } : undefined}
    >
      {/* HEADER_ACCENT_FLOAT: mismo patrón que en el resto de cabeceras — ver
          el comentario completo en SettingsPage.tsx. */}
      <header
        className="sticky top-0 z-10 overflow-hidden bg-[var(--color-brand-700)] px-4 pb-3"
        style={{ paddingTop: 'calc(0.75rem + env(safe-area-inset-top))' }}
      >
        <span className="pointer-events-none absolute -right-8 -top-16 h-36 w-36 rounded-full bg-[var(--color-brand-400)] opacity-50 blur-2xl" />
        <span className="pointer-events-none absolute -bottom-10 right-14 h-24 w-24 rounded-full bg-[var(--color-brand-300)] opacity-30 blur-xl" />
        <div className="relative mx-auto flex max-w-2xl items-center justify-between gap-2">
          <button onClick={() => navigate('/notes')} className="shrink-0 text-xl text-white/80 hover:text-white">
            ‹
          </button>
          <div className="min-w-0 flex-1">
            <button onClick={() => setShowMembers((s) => !s)} className="block text-xs text-white/75 hover:text-white">
              {acceptedMembers.length} {acceptedMembers.length === 1 ? t('list.member') : t('list.membersPlural')}
            </button>
          </div>
          {isOwner && (
            <button
              onClick={() => setShowInvite(true)}
              className="shrink-0 rounded-full bg-white px-3 py-1.5 text-sm font-medium text-[var(--color-brand-700)] shadow-[0_8px_18px_-8px_rgba(20,21,26,0.4)]"
            >
              {t('list.inviteButton')}
            </button>
          )}
        </div>

        {showMembers && (
          <div className="glass-panel mx-auto mt-3 max-w-2xl rounded-2xl p-3 text-sm">
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
                          <TrashIcon className="h-4 w-4" />
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

      <main className="mx-auto max-w-2xl px-3 py-5">
        {/* Diseño "tarjeta con lengüeta": una pestañita de color asomando
            arriba (como una nota adhesiva de verdad) en vez de la tarjeta
            de cristal neutra de siempre — para que una nota no se sienta
            como la de cualquier app de notas genérica. La lengüeta usa el
            acento de quien mira, igual que el resto de la app. */}
        <div>
          {/* La lengüeta va DENTRO de la propia tarjeta (pegada a su borde
              superior, por eso la tarjeta necesita "relative" y algo más
              de padding arriba), no en un envoltorio aparte por encima —
              así se queda embebida en el borde en vez de flotar suelta por
              fuera de la nota. */}
          <div className="glass-panel relative rounded-[22px] px-4 pb-4 pt-5">
            <span className="absolute left-6 top-0 h-2.5 w-14 rounded-b-md bg-[var(--color-brand-500)]" />
            <textarea
              ref={titleAreaRef}
              value={title}
              onChange={handleTitleChange}
              onKeyDown={(e) => {
                // El título sigue siendo conceptualmente "una línea": puede
                // ocupar varias líneas en pantalla si es largo, pero Intro
                // no debería meter un salto de línea manual dentro de él.
                if (e.key === 'Enter') e.preventDefault()
              }}
              onFocus={() => (titleFocusedRef.current = true)}
              onBlur={() => {
                titleFocusedRef.current = false
              }}
              placeholder={t('apuntes.titlePlaceholder')}
              rows={1}
              className="w-full resize-none overflow-hidden border-0 bg-transparent px-0 font-display text-xl font-bold leading-snug text-slate-900 focus:outline-none focus:ring-0 dark:text-slate-100"
            />
            {saveStatus !== 'idle' && (
              <p className="mb-1.5 mt-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                {saveStatus === 'saving' ? t('apuntes.saving') : t('apuntes.saved')}
              </p>
            )}
            <div className="mb-3 mt-3 h-px bg-[var(--color-glass-border)]" />
            <textarea
              value={body}
              onChange={handleBodyChange}
              onFocus={() => (bodyFocusedRef.current = true)}
              onBlur={() => {
                bodyFocusedRef.current = false
              }}
              placeholder={t('apuntes.bodyPlaceholder')}
              rows={16}
              className="w-full resize-none border-0 bg-transparent px-0 text-base leading-relaxed text-slate-800 focus:outline-none focus:ring-0 dark:text-slate-100"
            />
          </div>
        </div>
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
