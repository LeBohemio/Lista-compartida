import { useMemo, useState, type KeyboardEvent, type MouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../lib/i18n'
import { useNotes } from '../hooks/useNotes'
import { useLongPress } from '../hooks/useLongPress'
import { useDragReorder } from '../hooks/useDragReorder'
import { supabase } from '../lib/supabaseClient'
import CreateNoteModal from '../components/CreateNoteModal'
import ConfirmDialog from '../components/ConfirmDialog'
import ContextMenu from '../components/ContextMenu'
import {
  CheckIcon,
  CopyIcon,
  DragHandleIcon,
  FolderIcon,
  NotesIcon,
  PaletteIcon,
  PinIcon,
  ReorderIcon,
  SortAlphaIcon,
  SortDateIcon,
  TrashIcon,
} from '../components/icons'
import { PALETTE, colorForNote } from '../lib/colors'
import type { NoteWithMembership } from '../lib/types'

// Pantalla de "Notas comunes" (ver migration_v23.sql) — algo aparte de las
// listas, con su propia pestaña en la barra inferior.
export default function NotesPage() {
  const { profile } = useAuth()
  const { t, language } = useLanguage()
  const { notes, invitations, loading, error, refetch, togglePin, reorderNotes } = useNotes()
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
  // El menú de opciones de cada nota (y su submenú de "Reordenar") vivían
  // antes como estado LOCAL de cada NoteRow, con el <ContextMenu> renderizado
  // dentro de la propia tarjeta de esa nota (glass-panel). Eso rompía el
  // menú: cualquier ancestro con backdrop-filter (como .glass-panel) crea un
  // nuevo "contenedor" para todo lo que sea position:fixed dentro de él, así
  // que la hoja inferior (fixed inset-0) del menú quedaba atrapada dentro
  // del recuadro pequeño de esa nota en vez de cubrir toda la pantalla — se
  // veía "encima de la nota" en lugar de pegada abajo del todo. Subiendo el
  // estado aquí arriba, fuera de cualquier tarjeta con cristal esmerilado
  // (igual que menuTarget en ChatPanel.tsx, o colorPickerNote aquí mismo, que
  // nunca tuvo este problema), el menú vuelve a comportarse como en "Mis
  // listas".
  const [menuTarget, setMenuTarget] = useState<NoteWithMembership | null>(null)
  const [showSortMenu, setShowSortMenu] = useState(false)
  const [reorderMode, setReorderMode] = useState(false)
  const navigate = useNavigate()

  const changeNoteColor = async (noteId: string, color: string) => {
    setColorPickerNote(null)
    const { error: err } = await supabase.from('notes').update({ color }).eq('id', noteId)
    if (err) setActionError(t('common.saveError'))
    refetch()
  }

  const activeNotes = useMemo(() => notes.filter((n) => !pendingDeleteIds.has(n.id)), [notes, pendingDeleteIds])
  const normalizedQuery = searchQuery.trim().toLowerCase()
  const visibleNotes = useMemo(
    () =>
      normalizedQuery ? activeNotes.filter((n) => n.title.toLowerCase().includes(normalizedQuery)) : activeNotes,
    [activeNotes, normalizedQuery],
  )

  const reorder = useDragReorder<NoteWithMembership>({
    items: activeNotes,
    getId: (n) => n.id,
    onCommit: (ordered) => reorderNotes(ordered.map((n) => n.id)),
  })

  const applySortNotes = async (criterion: 'date' | 'alpha') => {
    const sorted = [...activeNotes].sort((a, b) =>
      criterion === 'alpha'
        ? a.title.localeCompare(b.title, language === 'en' ? 'en' : 'es')
        : new Date(b.last_activity_at).getTime() - new Date(a.last_activity_at).getTime(),
    )
    await reorderNotes(sorted.map((n) => n.id))
  }

  const respondInvitation = async (noteId: string, accept: boolean) => {
    const { error: err } = accept
      ? await supabase
          .from('note_members')
          .update({ status: 'accepted', responded_at: new Date().toISOString() })
          .eq('note_id', noteId)
          .eq('user_id', profile!.id)
      : await supabase.from('note_members').delete().eq('note_id', noteId).eq('user_id', profile!.id)
    if (err) setActionError(t('common.saveError'))
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

  // Mismo patrón que duplicateList en ListsPage.tsx: create_note_with_owner
  // crea la nota + la membresía del creador como owner en un único paso, y
  // luego copiamos aparte el texto y el color (la función de la base de
  // datos solo acepta el título, igual que al crear desde cero — ver
  // CreateNoteModal.tsx).
  const duplicateNote = async (n: NoteWithMembership) => {
    setActionError(null)
    const { data: rpcData, error: rpcErr } = await supabase.rpc('create_note_with_owner', {
      p_title: t('lists.copySuffix', { name: n.title }),
    })
    const newNote = rpcData as { id: string } | null
    if (rpcErr || !newNote) {
      setActionError(rpcErr?.message ?? t('apuntes.createError'))
      return
    }
    const { error: bodyErr } = await supabase.from('notes').update({ body: n.body, color: n.color }).eq('id', newNote.id)
    if (bodyErr) setActionError(t('common.saveError'))
    refetch()
    navigate(`/notes/${newNote.id}`)
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

          {!normalizedQuery && reorderMode && (
            <div className="glass-panel mb-3 flex items-center justify-between rounded-2xl px-3 py-2 text-sm text-[var(--color-brand-700)] dark:text-[var(--color-brand-300)]">
              <span>⠿ {t('reorder.bannerHint')}</span>
              <button onClick={() => setReorderMode(false)} className="font-semibold hover:underline">
                {t('reorder.done')}
              </button>
            </div>
          )}

          {loading ? (
            <p className="py-6 text-center text-sm text-slate-400">{t('list.loading')}</p>
          ) : activeNotes.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-400">{t('apuntes.empty')}</p>
          ) : normalizedQuery ? (
            // Mientras se busca, sin arrastre (igual que "Mis listas") — no
            // tiene sentido reordenar un subconjunto filtrado.
            visibleNotes.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-400">{t('lists.emptySearch')}</p>
            ) : (
              <ul className="space-y-2.5">
                {visibleNotes.map((n) => (
                  <li key={n.id}>
                    <NoteRow
                      note={n}
                      isOwner={n.owner_id === profile?.id}
                      onOpen={() => navigate(`/notes/${n.id}`)}
                      onOpenMenu={() => setMenuTarget(n)}
                      onDeleteRequest={(e) => requestDeleteOrLeave(e, n.id, n.title, n.owner_id === profile?.id)}
                    />
                  </li>
                ))}
              </ul>
            )
          ) : (
            <ul className="space-y-2.5">
              {reorder.displayItems.map((n) => (
                <li key={n.id}>
                  <NoteRow
                    note={n}
                    isOwner={n.owner_id === profile?.id}
                    dragging={reorder.draggingId === n.id}
                    reorderMode={reorderMode}
                    onRowRef={(el) => reorder.registerRow(n.id, el)}
                    onDragPointerDown={reorder.handlePointerDown(n.id)}
                    onDragPointerMove={reorder.handlePointerMove}
                    onDragPointerUp={reorder.handlePointerUp}
                    onOpen={() => navigate(`/notes/${n.id}`)}
                    onOpenMenu={() => setMenuTarget(n)}
                    onDeleteRequest={(e) => requestDeleteOrLeave(e, n.id, n.title, n.owner_id === profile?.id)}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>

      {/* Botón de confirmar reordenar: misma posición (en espejo, a la
          izquierda) que el "+" de crear lista en ListsPage.tsx — solo se ve
          mientras se está reordenando, como atajo a mano sin tener que subir
          hasta el aviso de arriba. Hace lo mismo que su botón "Listo". */}
      {reorderMode && (
        <button
          type="button"
          onClick={() => setReorderMode(false)}
          aria-label={t('reorder.done')}
          title={t('reorder.done')}
          className="fixed bottom-24 left-6 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-[var(--color-brand-500)] to-[var(--color-brand-600)] text-white shadow-[0_16px_30px_-10px_var(--color-glow)] ring-1 ring-[var(--color-glass-border)]"
        >
          <CheckIcon className="h-6 w-6" />
        </button>
      )}

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

      {colorPickerNote &&
        createPortal(
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
          </div>,
          document.body,
        )}

      {/* Menú de opciones de una nota, y su submenú de reordenar — ver el
          comentario junto a menuTarget más arriba sobre por qué viven aquí,
          fuera de cualquier tarjeta de cristal, y no dentro de NoteRow. */}
      {menuTarget && (
        <ContextMenu
          title={menuTarget.title}
          onClose={() => setMenuTarget(null)}
          actions={[
            {
              label: t('menu.open'),
              icon: <FolderIcon className="h-5 w-5" />,
              onSelect: () => navigate(`/notes/${menuTarget.id}`),
            },
            {
              label: menuTarget.membership.pinned ? t('menu.unpinNote') : t('menu.pinNote'),
              icon: <PinIcon className="h-5 w-5" />,
              onSelect: () => togglePin(menuTarget.id, !menuTarget.membership.pinned),
            },
            {
              label: t('menu.duplicate'),
              icon: <CopyIcon className="h-5 w-5" />,
              onSelect: () => duplicateNote(menuTarget),
            },
            {
              label: t('menu.reorder'),
              icon: <ReorderIcon className="h-5 w-5" />,
              onSelect: () => setShowSortMenu(true),
            },
            {
              label: t('menu.changeColor'),
              icon: <PaletteIcon className="h-5 w-5" />,
              onSelect: () => setColorPickerNote(menuTarget),
            },
          ]}
        />
      )}

      {showSortMenu && (
        <ContextMenu
          title={t('menu.reorder')}
          onClose={() => setShowSortMenu(false)}
          actions={[
            { label: t('reorder.byDate'), icon: <SortDateIcon className="h-5 w-5" />, onSelect: () => applySortNotes('date') },
            { label: t('reorder.alpha'), icon: <SortAlphaIcon className="h-5 w-5" />, onSelect: () => applySortNotes('alpha') },
            { label: t('reorder.custom'), icon: <DragHandleIcon className="h-5 w-5" />, onSelect: () => setReorderMode(true) },
          ]}
        />
      )}
    </div>
  )
}

// Misma "tarjeta con lengüeta" que el detalle de la nota (ver
// NoteDetailPage.tsx), con el mismo color — elegido a mano, o uno estable
// según el título (ver colorForNote) — para que el listado y el detalle se
// sientan como la misma pieza. Una pulsación larga abre el menú de opciones
// (Abrir/Fijar/Duplicar/Reordenar/Cambiar color), igual que en "Mis listas".
function NoteRow({
  note: n,
  isOwner,
  dragging,
  reorderMode,
  onRowRef,
  onDragPointerDown,
  onDragPointerMove,
  onDragPointerUp,
  onOpen,
  onOpenMenu,
  onDeleteRequest,
}: {
  note: NoteWithMembership
  isOwner: boolean
  dragging?: boolean
  reorderMode?: boolean
  onRowRef?: (el: HTMLElement | null) => void
  onDragPointerDown?: (e: ReactPointerEvent) => void
  onDragPointerMove?: (e: ReactPointerEvent) => void
  onDragPointerUp?: (e: ReactPointerEvent) => void
  onOpen: () => void
  onOpenMenu: () => void
  onDeleteRequest: (e: MouseEvent) => void
}) {
  const { t } = useLanguage()
  const longPress = useLongPress(onOpenMenu)
  const snippet = n.body.trim().slice(0, 80)
  const inReorder = reorderMode && !!onDragPointerDown

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') onOpen()
  }

  return (
    <div
      ref={onRowRef}
      role={inReorder ? undefined : 'button'}
      tabIndex={inReorder ? undefined : 0}
      onClick={inReorder ? undefined : onOpen}
      onKeyDown={inReorder ? undefined : handleKeyDown}
      className={`glass-panel relative flex w-full items-start gap-3 rounded-2xl px-3.5 pb-3.5 pt-5 text-left transition ${
        inReorder ? 'select-none' : ''
      } ${dragging ? 'shadow-lg ring-2 ring-brand-300' : ''}`}
      {...(inReorder ? {} : longPress)}
    >
      <span
        className="absolute left-5 top-0 h-2 w-10 rounded-b-md"
        style={{ backgroundColor: colorForNote(n) }}
        aria-hidden="true"
      />
      {inReorder ? (
        // El asa es lo único que arrastra — el resto de la tarjeta queda
        // libre para hacer scroll, igual que en "Mis listas" (ver ListRow en
        // ListsPage.tsx). touch-none va puesto de forma ESTÁTICA porque
        // tiene que estar así desde antes de tocar la pantalla para que el
        // navegador lo respete desde el primer instante.
        <button
          type="button"
          onPointerDown={onDragPointerDown}
          onPointerMove={onDragPointerMove}
          onPointerUp={onDragPointerUp}
          onPointerCancel={onDragPointerUp}
          aria-label={t('lists.dragHandle')}
          className="-m-2 mt-0.5 shrink-0 select-none p-2 text-slate-300 touch-none dark:text-slate-600"
          style={{ cursor: 'grab' }}
        >
          ⠿
        </button>
      ) : (
        <span className="mt-0.5 shrink-0 text-slate-400 dark:text-slate-500">
          <NotesIcon className="h-5 w-5" />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold text-slate-900 dark:text-slate-100">
          {n.membership.pinned && (
            <PinIcon className="mr-1 inline h-3.5 w-3.5 shrink-0 align-[-2px] text-[var(--color-brand-500)]" />
          )}
          {n.title}
        </span>
        {snippet && <span className="block truncate text-sm text-slate-500 dark:text-slate-400">{snippet}</span>}
      </span>
      {!inReorder && (
        <button
          type="button"
          onClick={onDeleteRequest}
          aria-label={isOwner ? t('apuntes.deleteNote') : t('apuntes.leaveNote')}
          title={isOwner ? t('apuntes.deleteNote') : t('apuntes.leaveNote')}
          className="shrink-0 rounded-full p-1.5 text-slate-300 hover:bg-red-50 hover:text-red-500 dark:text-slate-500 dark:hover:bg-red-950/40"
        >
          <TrashIcon className="h-4 w-4" />
        </button>
      )}
    </div>
  )
}
