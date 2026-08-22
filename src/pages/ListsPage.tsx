import { useMemo, useState, type MouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../lib/i18n'
import { useLists, type ItemStats } from '../hooks/useLists'
import { useLongPress } from '../hooks/useLongPress'
import { useDragReorder } from '../hooks/useDragReorder'
import { supabase } from '../lib/supabaseClient'
import CreateListModal from '../components/CreateListModal'
import GreetingSummary from '../components/GreetingSummary'
import Logo from '../components/Logo'
import Avatar from '../components/Avatar'
import ConfirmDialog from '../components/ConfirmDialog'
import ContextMenu from '../components/ContextMenu'
import Toast from '../components/Toast'
import {
  CheckIcon,
  CopyIcon,
  DragHandleIcon,
  FolderIcon,
  PinIcon,
  ReorderIcon,
  SortAlphaIcon,
  SortDateIcon,
  TrashIcon,
  UndoIcon,
} from '../components/icons'
import { colorForList } from '../lib/colors'
import type { ListWithMembership, Profile } from '../lib/types'

export default function ListsPage() {
  const { profile } = useAuth()
  const { t, language } = useLanguage()
  const [showSummary, setShowSummary] = useState(false)
  const { lists, invitations, itemStats, memberAvatars, loading, error, refetch, togglePin, reorderLists } =
    useLists()
  const [showCreate, setShowCreate] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
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

  const normalizedQuery = searchQuery.trim().toLowerCase()
  const visibleActiveLists = useMemo(
    () =>
      normalizedQuery
        ? activeLists.filter((l) => l.name.toLowerCase().includes(normalizedQuery))
        : activeLists,
    [activeLists, normalizedQuery],
  )

  const pendingNotesTotal = useMemo(
    () =>
      activeLists.reduce((sum, l) => {
        const s = itemStats[l.id]
        return sum + (s ? s.total - s.done : 0)
      }, 0),
    [activeLists, itemStats],
  )
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
        ? a.name.localeCompare(b.name, language === 'en' ? 'en' : 'es')
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
        setActionError(t('list.errorDelete', { message: err.message }))
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
        setActionError(t('list.errorLeave', { message: err.message }))
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
      p_name: t('lists.copySuffix', { name: l.name }),
      p_expenses_enabled: l.expenses_enabled,
    })
    const newList = rpcData as { id: string } | null
    if (rpcErr || !newList) {
      setActionError(t('list.errorDuplicate', { message: rpcErr?.message ?? t('list.unknownError') }))
      return
    }

    // La copia mantiene la divisa de la lista original, no la del perfil.
    await supabase.from('lists').update({ color: l.color, currency: l.currency }).eq('id', newList.id)

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
      className="min-h-screen pb-32"
      style={profile?.background_color ? { backgroundColor: profile.background_color } : undefined}
    >
      {/* Esta es la ÚNICA cabecera con este tratamiento especial — la
          principal, la que lleva el nombre del usuario. El resto de
          cabeceras de la app (Ajustes/Contactos/Notas/etc., ver
          HEADER_ACCENT_SOLID) van con el acento liso.
          "Formas suaves flotantes": fondo liso oscuro del acento con un par
          de manchas difuminadas (blur) del mismo acento en tonos más claros,
          flotando por detrás del contenido — le da textura y algo de vida
          sin ser un degradado de esquina a esquina ni un corte/círculo
          marcado (ambos probados antes y descartados). overflow-hidden para
          que las manchas, que se salen del propio rectángulo a propósito
          (así el difuminado no se corta en seco en el borde), no empujen el
          ancho de la página. Sigue siendo un rectángulo pegado arriba del
          todo, sin esquinas redondeadas. */}
      <header
        className="sticky top-0 z-10 overflow-hidden px-4 pb-4 shadow-[0_10px_24px_-16px_rgba(20,21,26,0.5)]"
        style={{
          paddingTop: 'calc(0.875rem + env(safe-area-inset-top))',
          backgroundColor: 'var(--color-brand-700)',
        }}
      >
        <span className="pointer-events-none absolute -right-8 -top-16 h-36 w-36 rounded-full bg-[var(--color-brand-400)] opacity-50 blur-2xl" />
        <span className="pointer-events-none absolute -bottom-10 right-14 h-24 w-24 rounded-full bg-[var(--color-brand-300)] opacity-30 blur-xl" />
        <div className="relative mx-auto flex max-w-2xl items-center justify-between">
          <button
            onClick={() => setShowSummary(true)}
            className="flex min-w-0 items-center gap-3 rounded-lg text-left"
          >
            {/* Antes el logo iba metido pequeño (28px) dentro de una
                "cajita" de 44px con fondo translúcido, dejando un margen
                vacío alrededor bastante visible. El propio icono ya trae su
                fondo de color hasta el borde, así que ahora ocupa toda la
                cajita él solo — sin espacio desperdiciado. */}
            <Logo size={44} className="shrink-0 rounded-2xl shadow-md" />
            <div className="min-w-0">
              {/* Ya no lleva "Buenos días/tardes/noches" delante — solo el
                  nombre, tal y como se pidió. */}
              <p className="truncate font-display font-medium leading-tight text-white">
                {profile?.username ?? '…'}
              </p>
              {statusLine && <p className="truncate text-xs text-white/75">{statusLine}</p>}
            </div>
          </button>
          {/* El acceso directo a "Mis gastos" que vivía aquí (un icono
              suelto junto al avatar) se ha quitado: era redundante con el
              botón "Mis gastos" que ya existe dentro de Ajustes — dos
              caminos al mismo sitio no aportaban nada, solo ruido en la
              cabecera. */}
          <button onClick={() => navigate('/settings')} className="relative shrink-0 rounded-full" aria-label={t('profile.title')}>
            {/* Antes la foto llevaba un anillo "de historia" (blanco -
                acento claro - blanco) alrededor, que le restaba varios
                píxeles de grosor y la dejaba más pequeña de lo que su hueco
                permitía. Se ha quitado ese anillo y la foto ahora ocupa
                los 44px enteros del hueco, igual que el logo de al lado. */}
            <Avatar
              username={profile?.username ?? '?'}
              avatarUrl={profile?.avatar_url}
              size={44}
              enlargeOnClick={false}
              className="shadow-md"
            />
            {invitations.length > 0 && (
              <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white ring-2 ring-[var(--color-surface)]">
                {invitations.length > 9 ? '9+' : invitations.length}
              </span>
            )}
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-6">
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
          <section className="mb-8">
            <h2 className="mb-3 font-mono text-xs uppercase tracking-wide text-[var(--color-brand-600)]">
              {t('lists.invitationsTitle')}
            </h2>
            <div className="space-y-3">
              {invitations.map((inv) => (
                <div
                  key={inv.id}
                  className="glass-panel flex items-center justify-between rounded-[22px] p-4"
                >
                  <div>
                    <p className="font-medium text-slate-900 dark:text-slate-100">{inv.name}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{t('lists.invitedToList')}</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => respondInvitation(inv.id, false)}
                      className="rounded-full border px-3 py-1.5 text-sm text-slate-600 hover:bg-white/60 border-[var(--color-glass-border)] dark:text-slate-300 dark:hover:bg-white/10"
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
              {t('lists.title')}
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
            <p className="text-sm text-slate-400">{t('lists.loadingLists')}</p>
          ) : activeLists.length === 0 ? (
            <div className="glass-panel rounded-[26px] p-8 text-center">
              <p className="mb-4 text-slate-500 dark:text-slate-400">{t('lists.empty')}</p>
              <button
                onClick={() => setShowCreate(true)}
                className="rounded-full bg-gradient-to-br from-[var(--color-brand-500)] to-[var(--color-brand-600)] px-4 py-2 font-medium text-white shadow-[0_10px_22px_-10px_var(--color-glow)]"
              >
                {t('lists.create')}
              </button>
            </div>
          ) : normalizedQuery ? (
            // Mientras se busca, mostramos la lista filtrada sin drag-and-drop
            // (no tiene sentido reordenar un subconjunto) — el orden real no
            // se toca para nada.
            visibleActiveLists.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-400">{t('lists.emptySearch')}</p>
            ) : (
              <div className="glass-panel overflow-hidden rounded-[26px]">
                {visibleActiveLists.map((l) => (
                  <ListRow
                    key={l.id}
                    list={l}
                    isOwner={l.owner_id === profile?.id}
                    stats={itemStats[l.id]}
                    avatars={memberAvatars[l.id] ?? []}
                    onOpen={() => navigate(`/lists/${l.id}`)}
                    onTogglePin={() => togglePin(l.id, !l.membership.pinned)}
                    onDuplicate={() => duplicateList(l)}
                    onComplete={() => requestComplete(l.id, l.name)}
                    onDeleteRequest={(e) => requestDeleteOrLeave(e, l.id, l.name, l.owner_id === profile?.id)}
                  />
                ))}
              </div>
            )
          ) : (
            // overflow-visible mientras se arrastra una lista, igual que en
            // la tarjeta de notas (ver NotepadCard en ItemsPanel.tsx) — si
            // no, en cuanto la lista se arrastraba fuera de este marco se
            // volvía invisible de golpe, dando la sensación de que el
            // arrastre se quedaba "pillado" ahí.
            <div
              className={`glass-panel rounded-[26px] ${
                reorder.draggingId ? 'overflow-visible' : 'overflow-hidden'
              }`}
            >
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
              className="mb-3 font-mono text-xs uppercase tracking-wide text-slate-500 hover:text-[var(--color-brand-600)] dark:text-slate-400"
            >
              {showArchived ? '▾' : '▸'} {t('lists.completedSection')} ({archivedLists.length})
            </button>
            {showArchived && (
              <div className="glass-panel overflow-hidden rounded-[26px] opacity-70">
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
        className="fixed bottom-24 right-6 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-[var(--color-brand-500)] to-[var(--color-brand-600)] text-2xl text-white shadow-[0_16px_30px_-10px_var(--color-glow)] ring-1 ring-[var(--color-glass-border)]"
        aria-label={t('lists.createFab')}
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

      {showSummary && (
        <GreetingSummary
          lists={activeLists}
          itemStats={itemStats}
          onClose={() => setShowSummary(false)}
          onSelectList={(listId) => {
            setShowSummary(false)
            navigate(`/lists/${listId}`)
          }}
        />
      )}

      {confirmTarget && (
        <ConfirmDialog
          title={confirmTarget.isOwner ? t('list.deleteTitle') : t('list.leaveTitle')}
          message={
            confirmTarget.isOwner
              ? t('dialogs.deleteMessage', { name: confirmTarget.name })
              : t('list.leaveConfirm', { name: confirmTarget.name })
          }
          confirmLabel={confirmTarget.isOwner ? t('menu.delete') : t('list.leaveButton')}
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
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const longPress = useLongPress(() => setShowMenu(true))
  const progressPct = stats && stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : null

  // Marcar como completada / reactivar se queda solo para quien creó la
  // lista — el botón ya no se oculta para el resto de miembros, pero al
  // tocarlo les sale este aviso en vez de hacer el cambio. Ver
  // migration_v24.sql.
  const showOwnerOnlyToast = () => {
    setToastMessage(t('list.ownerOnlyComplete'))
    setTimeout(() => setToastMessage(null), 2500)
  }

  const inReorder = reorderMode && !!onDragPointerDown
  return (
    <div
      ref={onRowRef}
      onClick={inReorder ? undefined : onOpen}
      role={inReorder ? undefined : 'button'}
      tabIndex={inReorder ? undefined : 0}
      className={`w-full p-4 text-left transition ${inReorder ? 'select-none' : ''} ${
        dragging
          ? 'relative rounded-xl shadow-lg ring-2 ring-brand-300 bg-[var(--color-surface)]'
          : 'hover:bg-slate-50 dark:hover:bg-white/5'
      }`}
      {...(inReorder ? {} : longPress)}
    >
      <div className="flex items-center justify-between">
        <div className="flex min-w-0 items-center gap-3">
          {inReorder && (
            // El asa es lo único que arrastra — el resto de la fila queda
            // libre (igual que en las notas, ver ItemRow en ItemsPanel.tsx).
            // touch-none va puesto aquí de forma ESTÁTICA (no depende de
            // "dragging") porque tiene que estar así desde antes de tocar
            // la pantalla para que el navegador lo respete desde el primer
            // instante — si se aplica solo cuando ya se está arrastrando,
            // el gesto de scroll nativo del móvil puede llegar a
            // adelantarse y quedarse peleando con el arrastre, dejando la
            // fila "pillada" si sueltas el dedo de forma rara.
            <button
              type="button"
              onPointerDown={onDragPointerDown}
              onPointerMove={onDragPointerMove}
              onPointerUp={onDragPointerUp}
              // Por si el navegador cancela el gesto por su cuenta (raro con
              // touch-action:none puesto bien, pero puede pasar por cosas
              // ajenas a nosotros: una llamada entrante, un gesto del
              // sistema...) — sin esto, la fila se quedaba "pillada" en
              // arrastre para siempre porque nunca llegaba un pointerup. Se
              // trata igual que soltar el dedo normal.
              onPointerCancel={onDragPointerUp}
              aria-label={t('lists.dragHandle')}
              className="-m-2 select-none p-2 text-slate-300 touch-none dark:text-slate-600"
              style={{ cursor: 'grab' }}
            >
              ⠿
            </button>
          )}
          {l.photo_url ? (
            // eslint-disable-next-line jsx-a11y/alt-text
            <img
              src={l.photo_url}
              alt=""
              aria-hidden="true"
              className="h-7 w-7 shrink-0 rounded-full object-cover ring-2 ring-white dark:ring-[var(--color-surface)]"
            />
          ) : (
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-white dark:ring-[var(--color-surface)]"
              style={{ backgroundColor: colorForList(l), boxShadow: `0 0 0 1px ${colorForList(l)}55` }}
              aria-hidden="true"
            />
          )}
          <div className="min-w-0">
            <p className="truncate font-medium text-slate-900 dark:text-slate-100">
              {l.membership.pinned && (
                <PinIcon className="mr-1 inline h-3.5 w-3.5 shrink-0 align-[-2px] text-[var(--color-brand-500)]" />
              )}
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
                  enlargeOnClick={false}
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
            <TrashIcon className="h-4 w-4" />
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
            { label: t('menu.open'), icon: <FolderIcon className="h-5 w-5" />, onSelect: onOpen },
            {
              label: l.membership.pinned ? t('menu.unpin') : t('menu.pin'),
              icon: <PinIcon className="h-5 w-5" />,
              onSelect: onTogglePin,
            },
            { label: t('menu.duplicate'), icon: <CopyIcon className="h-5 w-5" />, onSelect: onDuplicate },
            ...(onSortDate && onSortAlpha && onEnterCustomOrder
              ? [{ label: t('menu.reorder'), icon: <ReorderIcon className="h-5 w-5" />, onSelect: () => setShowSortMenu(true) }]
              : []),
            ...(onComplete
              ? [
                  {
                    label: t('menu.complete'),
                    icon: <CheckIcon className="h-5 w-5" />,
                    onSelect: () => (isOwner ? onComplete() : showOwnerOnlyToast()),
                  },
                ]
              : []),
            ...(onReactivate
              ? [
                  {
                    label: t('menu.reactivate'),
                    icon: <UndoIcon className="h-5 w-5" />,
                    onSelect: () => (isOwner ? onReactivate() : showOwnerOnlyToast()),
                  },
                ]
              : []),
          ]}
        />
      )}

      {toastMessage && <Toast message={toastMessage} />}

      {showSortMenu && onSortDate && onSortAlpha && onEnterCustomOrder && (
        <ContextMenu
          title={t('menu.reorder')}
          onClose={() => setShowSortMenu(false)}
          actions={[
            { label: t('reorder.byDate'), icon: <SortDateIcon className="h-5 w-5" />, onSelect: onSortDate },
            { label: t('reorder.alpha'), icon: <SortAlphaIcon className="h-5 w-5" />, onSelect: onSortAlpha },
            { label: t('reorder.custom'), icon: <DragHandleIcon className="h-5 w-5" />, onSelect: onEnterCustomOrder },
          ]}
        />
      )}
    </div>
  )
}
