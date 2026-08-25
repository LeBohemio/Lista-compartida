import { useMemo, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../lib/i18n'
import { useNotes } from '../hooks/useNotes'
import { supabase } from '../lib/supabaseClient'
import CreateNoteModal from '../components/CreateNoteModal'
import ConfirmDialog from '../components/ConfirmDialog'
import ContextMenu from '../components/ContextMenu'
import { useLongPress } from '../hooks/useLongPress'
import { FolderIcon, NotesIcon, PaletteIcon, PinIcon, TrashIcon } from '../components/icons'
import { PALETTE, colorForNote } from '../lib/colors'
import type { NoteWithMembership } from '../lib/types'

// Pantalla de "Notas comunes" (ver migration_v23.sql) — algo aparte de las
// listas, con su propia pestaña en la barra inferior.
export default function NotesPage() {
  const { profile } = useAuth()
  const { t } = useLanguage()
  const { notes, invitations, loading, error, refetch, togglePin } = useNotes()
  const [showCreate, setShowCreate] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [actionError, setActionError] = useState<string | null>(null)
  const [confirmTarget, setConfirmTarget] = useState<{ noteId: string; title: string; isOwner: boolean } | null>(
    null,
  )
  const [pendingDeleteIds, setPendingDeleteIds] = useState<Set<string>>(new Set())
  // Nota cuyo color se está eligiendo desde el menú de opciones (sin tener
  // que entrar en ella) — null cuando la hoja está cerrada.
  const [colorPickerNote, setColorPickerNote] = useState<NoteWithMembership | null>(null)
  const navigate = useNavigate()

  const changeNoteColor = async (noteId: string, color: string) => {
    setColorPickerNote(null)
    await supabase.from('notes').update({ color }).eq('id', noteId)
    refetch()
  }

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
      {/* HEADER_ACCENT_FLOAT: mismo patrón que en el resto de pestañas — ver
          el comentario completo en SettingsPage.tsx. El botón de crear se
          queda como píldora blanca: relleno del mismo acento se perdía
          contra la cabecera. */}
      <header
        className="sticky top-0 z-10 overflow-hidden bg-[var(--color-brand-700)] px-4 pb-4 shadow-[0_10px_24px_-16px_rgba(20,21,26,0.5)]"
        style={{ paddingTop: 'calc(0.875rem + env(safe-area-inset-top))' }}
      >
        <span className="pointer-events-none absolute -right-8 -top-16 h-36 w-36 rounded-full bg-[var(--color-brand-400)] opacity-50 blur-2xl" />
        <span className="pointer-events-none absolute -bottom-10 right-14 h-24 w-24 rounded-full bg-[var(--color-brand-300)] opacity-30 blur-xl" />
        <div className="relative mx-auto flex max-w-2xl items-center justify-between">
          <h1 className="font-display font-medium text-white">{t('apuntes.tabTitle')}</h1>
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="rounded-full bg-white px-3 py-1.5 text-sm font-medium text-[var(--color-brand-700)] shadow-[0_8px_18px_-8px_rgba(20,21,26,0.4)]"
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
            <ul className="space-y-2.5">
              {visibleNotes.map((n) => (
                <li key={n.id}>
                  <NoteRow
                    note={n}
                    isOwner={n.owner_id === profile?.id}
                    onOpen={() => navigate(`/notes/${n.id}`)}
                    onTogglePin={() => togglePin(n.id, !n.membership.pinned)}
                    onChangeColor={() => setColorPickerNote(n)}
                    onDeleteRequest={(e) => requestDeleteOrLeave(e, n.id, n.title, n.owner_id === profile?.id)}
                  />
                </li>
              ))}
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
            // justCreated activa el aviso discreto de "toca el color de
            // arriba para cambiarlo" en NoteDetailPage.tsx, solo esta
            // primera vez.
            navigate(`/notes/${noteId}`, { state: { justCreated: true } })
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

      {colorPickerNote && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
          onClick={() => setColorPickerNote(null)}
        >
          <div
            className="glass-panel w-full max-w-sm rounded-t-[28px] p-5 shadow-[0_24px_60px_-20px_rgba(20,21,26,0.5)] sm:rounded-[28px]"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="mb-4 truncate text-sm font-semibold text-slate-800 dark:text-slate-100">
              {colorPickerNote.title}
            </p>
            <div className="mb-4 flex flex-wrap gap-2.5">
              {PALETTE.map((c) => (
                <button
                  type="button"
                  key={c}
                  onClick={() => changeNoteColor(colorPickerNote.id, c)}
                  aria-label={`Color ${c}`}
                  className="h-9 w-9 rounded-full"
                  style={{
                    backgroundColor: c,
                    boxShadow: colorPickerNote.color === c ? `0 0 0 2px white, 0 0 0 4px ${c}` : 'none',
                  }}
                />
              ))}
            </div>
            <button
              onClick={() => setColorPickerNote(null)}
              className="w-full rounded-2xl px-4 py-2.5 text-center text-sm font-medium text-slate-500 hover:bg-white/60 dark:text-slate-400 dark:hover:bg-white/10"
            >
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// Misma "tarjeta con lengüeta" que el detalle de la nota (ver
// NoteDetailPage.tsx), con el mismo color — elegido a mano, o uno estable
// según el título (ver colorForNote) — para que el listado y el detalle se
// sientan como la misma pieza. Una pulsación larga abre el menú de
// opciones (Abrir/Fijar/Cambiar color), igual que en "Mis listas".
function NoteRow({
  note: n,
  isOwner,
  onOpen,
  onTogglePin,
  onChangeColor,
  onDeleteRequest,
}: {
  note: NoteWithMembership
  isOwner: boolean
  onOpen: () => void
  onTogglePin: () => void
  onChangeColor: () => void
  onDeleteRequest: (e: MouseEvent) => void
}) {
  const { t } = useLanguage()
  const [showMenu, setShowMenu] = useState(false)
  const longPress = useLongPress(() => setShowMenu(true))
  const snippet = n.body.trim().slice(0, 80)

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') onOpen()
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={handleKeyDown}
      className="glass-panel relative flex w-full select-none items-start gap-3 rounded-2xl px-3.5 pb-3.5 pt-5 text-left transition"
      {...longPress}
    >
      <span
        className="absolute left-5 top-0 h-2 w-10 rounded-b-md"
        style={{ backgroundColor: colorForNote(n) }}
        aria-hidden="true"
      />
      <span className="mt-0.5 shrink-0 text-slate-400 dark:text-slate-500">
        <NotesIcon className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold text-slate-900 dark:text-slate-100">
          {n.membership.pinned && (
            <PinIcon className="mr-1 inline h-3.5 w-3.5 shrink-0 align-[-2px] text-[var(--color-brand-500)]" />
          )}
          {n.title}
        </span>
        {snippet && <span className="block truncate text-sm text-slate-500 dark:text-slate-400">{snippet}</span>}
      </span>
      <button
        type="button"
        onClick={onDeleteRequest}
        aria-label={isOwner ? t('apuntes.deleteNote') : t('apuntes.leaveNote')}
        title={isOwner ? t('apuntes.deleteNote') : t('apuntes.leaveNote')}
        className="shrink-0 rounded-full p-1.5 text-slate-300 hover:bg-red-50 hover:text-red-500 dark:text-slate-500 dark:hover:bg-red-950/40"
      >
        <TrashIcon className="h-4 w-4" />
      </button>

      {showMenu && (
        <ContextMenu
          title={n.title}
          onClose={() => setShowMenu(false)}
          actions={[
            { label: t('menu.open'), icon: <FolderIcon className="h-5 w-5" />, onSelect: onOpen },
            {
              label: n.membership.pinned ? t('menu.unpinNote') : t('menu.pinNote'),
              icon: <PinIcon className="h-5 w-5" />,
              onSelect: onTogglePin,
            },
            { label: t('menu.changeColor'), icon: <PaletteIcon className="h-5 w-5" />, onSelect: onChangeColor },
          ]}
        />
      )}
    </div>
  )
}
