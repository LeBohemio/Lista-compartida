import { useMemo, useState, type MouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../lib/i18n'
import { useLists, type ItemStats } from '../hooks/useLists'
import { useLongPress } from '../hooks/useLongPress'
import { useDragReorder } from '../hooks/useDragReorder'
import { supabase } from '../lib/supabaseClient'
import CreateListModal from '../components/CreateListModal'
import Logo from '../components/Logo'
import Avatar from '../components/Avatar'
import ProfileModal from '../components/ProfileModal'
import ConfirmDialog from '../components/ConfirmDialog'
import ContextMenu from '../components/ContextMenu'
import { colorForList } from '../lib/colors'
import type { ListWithMembership, Profile } from '../lib/types'

export default function ListsPage() {
  const { profile } = useAuth()
  const { t } = useLanguage()
  const { lists, invitations, itemStats, memberAvatars, loading, error, refetch, togglePin, reorderLists } =
    useLists()
  const [showCreate, setShowCreate] = useState(false)
  const [showProfile, setShowProfile] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [confirmTarget, setConfirmTarget] = useState<{ listId: string; name: string; isOwner: boolean } | null>(null)
  const [confirmComplete, setConfirmComplete] = useState<{ listId: string; name: string } | null>(null)
  const [pendingDeleteIds, setPendingDeleteIds] = useState<Set<string>>(new Set())
  const [reorderMode, setReorderMode] = useState(false)
  const navigate = useNavigate()

  const activeLists = useMemo(
    () => lists.filter((l) => !l.archived_at && !pendingDeleteIds.has(l.id)),
    [lists, pendingDeleteIds],
  )
  const archivedLists = useMemo(
    () => lists.filter((l) => l.archived_at && !pendingDeleteIds.has(l.id)),
    [lists, pendingDeleteIds],
  )

  const pendingNotesTotal = useMemo(
    () =>
      activeLists.reduce((sum, l) => {
        const s = itemStats[l.id]
        return sum + (s ? s.total - s.done : 0)
      }, 0),
    [activeLists, itemStats],
  )
  const greeting = useMemo(() => {
    const hour = new Date().getHours()
    if (hour < 12) return t('home.morning')
    if (hour < 20) return t('home.afternoon')
    return t('home.evening')
  }, [t])
  const statusLine =
    activeLists.length === 0
      ? null
      : pendingNotesTotal === 0
        ? t('home.allDone')
        : `${activeLists.length} ${t('home.activeLists')} · ${pendingNotesTotal} ${t('home.pendingNotes')}`

  const reorder = useDragReorder<ListWithMembership>({
    items: activeLists,
    getId: (l) => l.id,
    onCommit: (ordered) => reorderLists(ordered.map((l) => l.id)),
  })

  const applySortLists = async (criterion: 'date' | 'alpha') => {
    const sorted = [...activeLists].sort((a, b) =>
      criterion === 'alpha'
        ? a.name.localeCompare(b.name, 'es')
        : new Date(b.last_activity_at).getTime() - new Date(a.last_activity_at).getTime(),
    )
    await reorderLists(sorted.map((l) => l.id))
  }

  const respondInvitation = async (listId: string, accept: boolean) => {
    if (accept) {
      await supabase
        .from('list_members')
        .update({ status: 'accepted', responded_at: new Date().toISOString() })
        .eq('list_id', listId)
        .eq('user_id', profile!.id)
    } else {
      await supabase.from('list_members').delete().eq('list_id', listId).eq('user_id', profile!.id)
    }
    refetch()
  }

  const requestDeleteOrLeave = (e: MouseEvent, listId: string, name: string, isOwner: boolean) => {
    e.stopPropagation()
    setActionError(null)
    setConfirmTarget({ listId, name, isOwner })
  }

  const confirmDeleteOrLeave = async () => {
    if (!confirmTarget) return
    const { listId, isOwner } = confirmTarget
    setConfirmTarget(null)
    // La quitamos de la vista al instante, sin esperar a la respuesta del
    // servidor ni a que llegue el evento de tiempo real — así no hace
    // falta refrescar la página para verla desaparecer.
    setPendingDeleteIds((prev) => new Set(prev).add(listId))
    if (isOwner) {
      const { error: err } = await supabase.from('lists').delete().eq('id', listId)
      if (err) {
        setPendingDeleteIds((prev) => {
          const next = new Set(prev)
          next.delete(listId)
          return next
        })
        setActionError(`No se pudo eliminar la lista: ${err.message}`)
        return
      }
    } else {
      const { error: err } = await supabase
        .from('list_members')
        .delete()
        .eq('list_id', listId)
        .eq('user_id', profile!.id)
      if (err) {
        setPendingDeleteIds((prev) => {
          const next = new Set(prev)
          next.delete(listId)
          return next
        })
        setActionError(`No se pudo salir de la lista: ${err.message}`)
        return
      }
    }
    refetch()
  }

  const requestComplete = (listId: string, name: string) => {
    setActionError(null)
    setConfirmComplete({ listId, name })
  }

  const confirmCompleteList = async () => {
    if (!confirmComplete) return
    const { listId } = confirmComplete
    setConfirmComplete(null)
    await supabase.from('lists').update({ archived_at: new Date().toISOString() }).eq('id', listId)
    refetch()
  }

  const reactivateList = async (listId: string) => {
    await supabase.from('lists').update({ archived_at: null }).eq('id', listId)
    refetch()
  }

  const duplicateList = async (l: ListWithMembership) => {
    setActionError(null)
    const { data: rpcData, error: rpcErr } = await supabase.rpc('create_list_with_owner', {
      p_name: `${l.name} (copia)`,
      p_expenses_enabled: l.expenses_enabled,
    })
    const newList = rpcData as { id: string } | null
    if (rpcErr || !newList) {
      setActionError(`No se pudo duplicar la lista: ${rpcErr?.message ?? 'error desconocido'}`)
      return
    }

    await supabase.from('lists').update({ color: l.color }).eq('id', newList.id)

    const { data: sourceItems } = await supabase.from('items').select('content').eq('list_id', l.id)
    if (sourceItems && sourceItems.length > 0 && profile) {
      const rows = sourceItems.map((it: { content: string }) => ({
        list_id: newList.id,
        content: it.content,
        created_by: profile.id,
      }))
      await supabase.from('items').insert(rows)
    }

    refetch()
    navigate(`/lists/${newList.id}`)
  }

  return (
    <div
      className="min-h-screen bg-slate-50 pb-24 dark:bg-slate-900"
      style={profile?.background_color ? { backgroundColor: profile.background_color } : undefined}
    >
      <header className="sticky top-0 z-10 overflow-hidden bg-gradient-to-br from-brand-500 to-brand-700 px-4 pb-5 pt-4 text-white shadow-sm">
        <div
          className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/10"
          aria-hidden="true"
        />
        <div className="relative mx-auto flex max-w-2xl items-center justify-between">
          <div className="flex items-center gap-3">
            <Logo size={40} className="rounded-xl shadow-md ring-1 ring-white/30" />
            <div>
              <p className="font-semibold leading-tight">
                {greeting}, {profile?.username ?? '…'}
              </p>
              {statusLine && <p className="text-xs text-white/80">{statusLine}</p>}
            </div>
          </div>
          <button onClick={() => setShowProfile(true)} className="relative rounded-full" aria-label="Tu perfil">
            <Avatar
              username={profile?.username ?? '?'}
              avatarUrl={profile?.avatar_url}
              size={38}
              className="ring-2 ring-white/70 hover:ring-white"
            />
            {invitations.length > 0 && (
              <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white ring-2 ring-white">
                {invitations.length > 9 ? '9+' : invitations.length}
              </span>
            )}
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-6">
        {error && <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950">{error}</p>}
        {actionError && (
          <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950">{actionError}</p>
        )}

        {invitations.length > 0 && (
          <section className="mb-8">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              {t('lists.invitationsTitle')}
            </h2>
            <div className="space-y-3">
              {invitations.map((inv) => (
                <div
                  key={inv.id}
                  className="flex items-center justify-between rounded-xl bg-amber-50 p-4 ring-1 ring-amber-200 dark:bg-amber-950/40 dark:ring-amber-900"
                >
                  <div>
                    <p className="font-medium text-slate-900 dark:text-slate-100">{inv.name}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">Te han invitado a esta lista</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => respondInvitation(inv.id, false)}
                      className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-white dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
                    >
                      {t('lists.reject')}
                    </button>
                    <button
                      onClick={() => respondInvitation(inv.id, true)}
                      className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
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
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              {t('lists.title')}
            </h2>
          </div>

          {reorderMode && (
            <div className="mb-3 flex items-center justify-between rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-700 dark:bg-brand-950/40 dark:text-brand-300">
              <span>⠿ {t('reorder.bannerHint')}</span>
              <button onClick={() => setReorderMode(false)} className="font-semibold hover:underline">
                {t('reorder.done')}
              </button>
            </div>
          )}

          {loading ? (
            <p className="text-sm text-slate-400">Cargando listas…</p>
          ) : activeLists.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center dark:border-slate-600">
              <p className="mb-4 text-slate-500 dark:text-slate-400">{t('lists.empty')}</p>
              <button
                onClick={() => setShowCreate(true)}
                className="rounded-lg bg-brand-600 px-4 py-2 font-medium text-white hover:bg-brand-700"
              >
                {t('lists.create')}
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {reorder.displayItems.map((l) => (
                <ListRow
                  key={l.id}
                  list={l}
                  isOwner={l.owner_id === profile?.id}
                  stats={itemStats[l.id]}
                  avatars={memberAvatars[l.id] ?? []}
                  dragging={reorder.draggingId === l.id}
                  reorderMode={reorderMode}
                  onRowRef={(el) => reorder.registerRow(l.id, el)}
                  onDragPointerDown={reorder.handlePointerDown(l.id)}
                  onDragPointerMove={reorder.handlePointerMove}
                  onDragPointerUp={reorder.handlePointerUp}
                  onSortDate={() => applySortLists('date')}
                  onSortAlpha={() => applySortLists('alpha')}
                  onEnterCustomOrder={() => setReorderMode(true)}
                  onOpen={() => navigate(`/lists/${l.id}`)}
                  onTogglePin={() => togglePin(l.id, !l.membership.pinned)}
                  onDuplicate={() => duplicateList(l)}
                  onComplete={() => requestComplete(l.id, l.name)}
                  onDeleteRequest={(e) => requestDeleteOrLeave(e, l.id, l.name, l.owner_id === profile?.id)}
                />
              ))}
            </div>
          )}
        </section>

        {archivedLists.length > 0 && (
          <section className="mt-8">
            <button
              onClick={() => setShowArchived((s) => !s)}
              className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500 hover:text-brand-600 dark:text-slate-400"
            >
              {showArchived ? '▾' : '▸'} {t('lists.completedSection')} ({archivedLists.length})
            </button>
            {showArchived && (
              <div className="space-y-3 opacity-70">
                {archivedLists.map((l) => (
                  <ListRow
                    key={l.id}
                    list={l}
                    isOwner={l.owner_id === profile?.id}
                    stats={itemStats[l.id]}
                    avatars={memberAvatars[l.id] ?? []}
                    onOpen={() => navigate(`/lists/${l.id}`)}
                    onTogglePin={() => togglePin(l.id, !l.membership.pinned)}
                    onDuplicate={() => duplicateList(l)}
                    onReactivate={() => reactivateList(l.id)}
                    onDeleteRequest={(e) => requestDeleteOrLeave(e, l.id, l.name, l.owner_id === profile?.id)}
                  />
                ))}
              </div>
            )}
          </section>
        )}
      </main>

      <button
        onClick={() => setShowCreate(true)}
        className="fixed bottom-6 right-6 flex h-14 w-14 items-center justify-center rounded-full bg-brand-600 text-2xl text-white shadow-lg hover:bg-brand-700"
        aria-label="Crear lista"
      >
        +
      </button>

      {showCreate && (
        <CreateListModal
          onClose={() => setShowCreate(false)}
          onCreated={(listId) => {
            setShowCreate(false)
            navigate(`/lists/${listId}`)
          }}
        />
      )}

      {showProfile && <ProfileModal onClose={() => setShowProfile(false)} />}

      {confirmTarget && (
        <ConfirmDialog
          title={confirmTarget.isOwner ? 'Eliminar lista' : 'Salir de la lista'}
          message={
            confirmTarget.isOwner
              ? t('dialogs.deleteMessage', { name: confirmTarget.name })
              : `¿Salir de la lista "${confirmTarget.name}"? Dejarás de verla, pero seguirá existiendo para el resto.`
          }
          confirmLabel={confirmTarget.isOwner ? 'Eliminar' : 'Salir'}
          danger={confirmTarget.isOwner}
          onCancel={() => setConfirmTarget(null)}
          onConfirm={confirmDeleteOrLeave}
        />
      )}

      {confirmComplete && (
        <ConfirmDialog
          title={t('dialogs.completeTitle')}
          message={t('dialogs.completeMessage')}
          confirmLabel={t('dialogs.completeConfirm')}
          onCancel={() => setConfirmComplete(null)}
          onConfirm={confirmCompleteList}
        />
      )}
    </div>
  )
}

function ListRow({
  list: l,
  isOwner,
  stats,
  avatars,
  dragging,
  reorderMode,
  onRowRef,
  onDragPointerDown,
  onDragPointerMove,
  onDragPointerUp,
  onSortDate,
  onSortAlpha,
  onEnterCustomOrder,
  onOpen,
  onTogglePin,
  onDuplicate,
  onComplete,
  onReactivate,
  onDeleteRequest,
}: {
  list: ListWithMembership
  isOwner: boolean
  stats?: ItemStats
  avatars: Profile[]
  dragging?: boolean
  reorderMode?: boolean
  onRowRef?: (el: HTMLElement | null) => void
  onDragPointerDown?: (e: ReactPointerEvent) => void
  onDragPointerMove?: (e: ReactPointerEvent) => void
  onDragPointerUp?: (e: ReactPointerEvent) => void
  onSortDate?: () => void
  onSortAlpha?: () => void
  onEnterCustomOrder?: () => void
  onOpen: () => void
  onTogglePin: () => void
  onDuplicate: () => void
  onComplete?: () => void
  onReactivate?: () => void
  onDeleteRequest: (e: MouseEvent) => void
}) {
  const { t } = useLanguage()
  const [showMenu, setShowMenu] = useState(false)
  const [showSortMenu, setShowSortMenu] = useState(false)
  const longPress = useLongPress(() => setShowMenu(true))
  const progressPct = stats && stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : null

  return (
    <div
      ref={onRowRef}
      onClick={onOpen}
      role="button"
      tabIndex={0}
      className={`w-full rounded-xl bg-white p-4 text-left shadow-sm ring-1 ring-slate-200 transition hover:shadow-md hover:ring-brand-300 dark:bg-slate-800 dark:ring-slate-700 ${
        dragging ? 'relative z-10 ring-2 ring-brand-300' : ''
      }`}
      {...longPress}
    >
      <div className="flex items-center justify-between">
        <div className="flex min-w-0 items-center gap-3">
          {reorderMode && onDragPointerDown && (
            <button
              onClick={(e) => e.stopPropagation()}
              onPointerDown={onDragPointerDown}
              onPointerMove={onDragPointerMove}
              onPointerUp={onDragPointerUp}
              aria-label={t('lists.dragHandle')}
              title={t('lists.dragHandle')}
              className="shrink-0 touch-none select-none px-0.5 text-slate-300 hover:text-slate-500 dark:text-slate-600 dark:hover:text-slate-400"
              style={{ cursor: 'grab' }}
            >
              ⠿
            </button>
          )}
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-white dark:ring-slate-800"
            style={{ backgroundColor: colorForList(l), boxShadow: `0 0 0 1px ${colorForList(l)}55` }}
            aria-hidden="true"
          />
          <div className="min-w-0">
            <p className="truncate font-medium text-slate-900 dark:text-slate-100">
              {l.membership.pinned && <span className="mr-1">📌</span>}
              {l.name}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {isOwner ? t('lists.owner') : t('lists.member')}
              {l.expenses_enabled ? ` · ${t('lists.expensesOn')}` : ''}
              {l.archived_at ? ` · ${t('lists.completedBadge')}` : ''}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {avatars.length > 1 && (
            <div className="mr-1 flex items-center">
              {avatars.slice(0, 4).map((p, idx) => (
                <Avatar
                  key={p.id}
                  username={p.username}
                  avatarUrl={p.avatar_url}
                  size={22}
                  className={`ring-2 ring-white dark:ring-slate-800 ${idx > 0 ? '-ml-2' : ''}`}
                />
              ))}
              {avatars.length > 4 && (
                <span className="-ml-2 flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-slate-200 px-1 text-[10px] font-semibold text-slate-600 ring-2 ring-white dark:bg-slate-700 dark:text-slate-300 dark:ring-slate-800">
                  +{avatars.length - 4}
                </span>
              )}
            </div>
          )}
          <button
            onClick={onDeleteRequest}
            aria-label={isOwner ? t('lists.deleteList') : t('lists.leaveList')}
            title={isOwner ? t('lists.deleteList') : t('lists.leaveList')}
            className="rounded-lg p-1.5 text-slate-300 hover:bg-red-50 hover:text-red-500"
          >
            🗑
          </button>
          <span className="text-slate-300 dark:text-slate-600">›</span>
        </div>
      </div>
      {progressPct !== null && (
        <div className="mt-3 flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
            <div className="h-full rounded-full bg-brand-500 transition-all" style={{ width: `${progressPct}%` }} />
          </div>
          <span className="shrink-0 text-[11px] text-slate-400">
            {stats!.done}/{stats!.total}
          </span>
        </div>
      )}

      {showMenu && (
        <ContextMenu
          title={l.name}
          onClose={() => setShowMenu(false)}
          actions={[
            { label: t('menu.open'), icon: '📂', onSelect: onOpen },
            {
              label: l.membership.pinned ? t('menu.unpin') : t('menu.pin'),
              icon: '📌',
              onSelect: onTogglePin,
            },
            { label: t('menu.duplicate'), icon: '⧉', onSelect: onDuplicate },
            ...(onSortDate && onSortAlpha && onEnterCustomOrder
              ? [{ label: t('menu.reorder'), icon: '↕️', onSelect: () => setShowSortMenu(true) }]
              : []),
            ...(isOwner && onComplete
              ? [{ label: t('menu.complete'), icon: '✓', onSelect: onComplete }]
              : []),
            ...(isOwner && onReactivate
              ? [{ label: t('menu.reactivate'), icon: '↩', onSelect: onReactivate }]
              : []),
          ]}
        />
      )}

      {showSortMenu && onSortDate && onSortAlpha && onEnterCustomOrder && (
        <ContextMenu
          title={t('menu.reorder')}
          onClose={() => setShowSortMenu(false)}
          actions={[
            { label: t('reorder.byDate'), icon: '🕓', onSelect: onSortDate },
            { label: t('reorder.alpha'), icon: '🔤', onSelect: onSortAlpha },
            { label: t('reorder.custom'), icon: '⠿', onSelect: onEnterCustomOrder },
          ]}
        />
      )}
    </div>
  )
}
