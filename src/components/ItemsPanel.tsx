import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../lib/i18n'
import { useLongPress } from '../hooks/useLongPress'
import { useDragReorder } from '../hooks/useDragReorder'
import Avatar from './Avatar'
import UndoToast from './UndoToast'
import ConfirmDialog from './ConfirmDialog'
import ContextMenu from './ContextMenu'
import type { Item, ItemSuggestion } from '../lib/types'

const UNDO_DELAY_MS = 5000
const SEARCH_THRESHOLD = 8

function normalize(text: string) {
  return text.trim().toLowerCase()
}

function todayISO() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function formatDueDate(dateStr: string) {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })
}

function sortByPosition(a: Item, b: Item) {
  const pa = a.position ?? Number.MAX_SAFE_INTEGER
  const pb = b.position ?? Number.MAX_SAFE_INTEGER
  if (pa !== pb) return pa - pb
  return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
}

export default function ItemsPanel({
  listId,
  items,
  soloList,
  readOnly,
}: {
  listId: string
  items: Item[]
  soloList: boolean
  readOnly?: boolean
}) {
  const { user } = useAuth()
  const { t } = useLanguage()
  const [content, setContent] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [dueDateTarget, setDueDateTarget] = useState<Item | null>(null)
  const [confirmEmpty, setConfirmEmpty] = useState(false)
  const [suggestions, setSuggestions] = useState<ItemSuggestion[]>([])
  const [search, setSearch] = useState('')
  const [showAddSheet, setShowAddSheet] = useState(false)
  const [reorderMode, setReorderMode] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const [pendingDeleteIds, setPendingDeleteIds] = useState<Set<string>>(new Set())
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const [lastPendingId, setLastPendingId] = useState<string | null>(null)

  const notDeleted = items.filter((i) => !pendingDeleteIds.has(i.id))
  const visibleItems = search.trim()
    ? notDeleted.filter((i) => normalize(i.content).includes(normalize(search)))
    : notDeleted
  const searching = search.trim().length > 0
  const doneItems = useMemo(() => visibleItems.filter((i) => i.done).sort(sortByPosition), [visibleItems])
  const pendingItems = useMemo(() => visibleItems.filter((i) => !i.done).sort(sortByPosition), [visibleItems])

  const persistOrder = async (ordered: Item[]) => {
    await Promise.all(ordered.map((it, idx) => supabase.from('items').update({ position: idx }).eq('id', it.id)))
  }

  const pendingReorder = useDragReorder<Item>({
    items: pendingItems,
    getId: (i) => i.id,
    onCommit: persistOrder,
  })
  const doneReorder = useDragReorder<Item>({
    items: doneItems,
    getId: (i) => i.id,
    onCommit: persistOrder,
  })

  const applySort = async (criterion: 'date' | 'alpha') => {
    const sortFn = (a: Item, b: Item) =>
      criterion === 'alpha'
        ? a.content.localeCompare(b.content, 'es')
        : new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    await Promise.all([
      persistOrder([...pendingItems].sort(sortFn)),
      persistOrder([...doneItems].sort(sortFn)),
    ])
  }

  const fetchSuggestions = useCallback(async () => {
    const { data } = await supabase
      .from('item_suggestions')
      .select('*')
      .eq('list_id', listId)
      .order('use_count', { ascending: false })
      .order('updated_at', { ascending: false })
      .limit(10)
    setSuggestions((data as ItemSuggestion[]) ?? [])
  }, [listId])

  useEffect(() => {
    fetchSuggestions()
  }, [fetchSuggestions])

  const currentNormalized = useMemo(() => new Set(notDeleted.map((i) => normalize(i.content))), [notDeleted])
  const visibleSuggestions = suggestions.filter((s) => !currentNormalized.has(s.normalized)).slice(0, 6)

  const createItem = async (rawContent: string) => {
    const trimmed = rawContent.trim()
    if (!trimmed || !user) return
    await supabase.from('items').insert({ list_id: listId, content: trimmed, created_by: user.id })
    await supabase.rpc('bump_item_suggestion', { p_list_id: listId, p_content: trimmed })
    fetchSuggestions()
  }

  const addItem = async (e: FormEvent) => {
    e.preventDefault()
    if (!content.trim()) return
    setSubmitting(true)
    // Si escribes varias separadas por comas ("Huevos, calamares, pan"),
    // se añaden como notas independientes en vez de una sola con comas.
    const parts = content
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean)
    for (const part of parts) {
      await createItem(part)
    }
    setContent('')
    setSubmitting(false)
    inputRef.current?.focus()
  }

  const addSuggestion = async (suggestion: ItemSuggestion) => {
    await createItem(suggestion.content)
  }

  const toggleDone = async (item: Item) => {
    await supabase
      .from('items')
      .update({ done: !item.done, done_at: !item.done ? new Date().toISOString() : null })
      .eq('id', item.id)
  }

  const saveEdit = async (itemId: string, newContent: string) => {
    setEditingId(null)
    const trimmed = newContent.trim()
    if (!trimmed) return
    await supabase.from('items').update({ content: trimmed }).eq('id', itemId)
  }

  const setDueDate = async (itemId: string, dueDate: string | null) => {
    await supabase.from('items').update({ due_date: dueDate }).eq('id', itemId)
  }

  const requestDelete = (itemId: string) => {
    setPendingDeleteIds((prev) => new Set(prev).add(itemId))
    setLastPendingId(itemId)
    const timer = setTimeout(async () => {
      timersRef.current.delete(itemId)
      await supabase.from('items').delete().eq('id', itemId)
      setPendingDeleteIds((prev) => {
        const next = new Set(prev)
        next.delete(itemId)
        return next
      })
      setLastPendingId((cur) => (cur === itemId ? null : cur))
    }, UNDO_DELAY_MS)
    timersRef.current.set(itemId, timer)
  }

  const undoDelete = (itemId: string) => {
    const timer = timersRef.current.get(itemId)
    if (timer) {
      clearTimeout(timer)
      timersRef.current.delete(itemId)
    }
    setPendingDeleteIds((prev) => {
      const next = new Set(prev)
      next.delete(itemId)
      return next
    })
    setLastPendingId((cur) => (cur === itemId ? null : cur))
  }

  const emptyDone = async () => {
    setConfirmEmpty(false)
    await supabase.from('items').delete().eq('list_id', listId).eq('done', true)
  }

  const markAllDone = async () => {
    await supabase
      .from('items')
      .update({ done: true, done_at: new Date().toISOString() })
      .eq('list_id', listId)
      .eq('done', false)
  }

  return (
    <div>
      {items.length > SEARCH_THRESHOLD && (
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('notes.searchPlaceholder')}
          className="mb-4 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 dark:border-[var(--color-surface-border)] dark:bg-[var(--color-surface)] dark:text-slate-100"
        />
      )}

      {reorderMode && (
        <div className="mb-3 flex items-center justify-between rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-700 dark:bg-brand-950/40 dark:text-brand-300">
          <span>⠿ {t('reorder.bannerHint')}</span>
          <button onClick={() => setReorderMode(false)} className="font-semibold hover:underline">
            {t('reorder.done')}
          </button>
        </div>
      )}

      {visibleItems.length === 0 ? (
        searching ? (
          <p className="py-8 text-center text-sm text-slate-400">{t('notes.emptySearch')}</p>
        ) : (
          <div className="py-8 text-center">
            <p className="mb-4 text-sm text-slate-400">{t('notes.empty')}</p>
            {!readOnly && (
              <button
                onClick={() => setShowAddSheet(true)}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
              >
                {t('notes.addFirst')}
              </button>
            )}
          </div>
        )
      ) : (
        <div className="space-y-4 pb-24">
          {readOnly && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
              🔒 {t('notes.readOnlyHint')}
            </p>
          )}
          {!readOnly && pendingItems.length > 0 && (
            <div className="mb-2 flex justify-end">
              <button
                onClick={markAllDone}
                className="text-xs font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400"
              >
                {t('notes.markAllDone')}
              </button>
            </div>
          )}

          <NotepadCard>
            {pendingReorder.displayItems.map((item) => (
              <ItemRow
                key={item.id}
                item={item}
                soloList={soloList}
                editing={editingId === item.id}
                dragging={pendingReorder.draggingId === item.id}
                draggable={!searching && !readOnly}
                reorderMode={reorderMode}
                readOnly={readOnly}
                onRowRef={(el) => pendingReorder.registerRow(item.id, el)}
                onDragPointerDown={pendingReorder.handlePointerDown(item.id)}
                onDragPointerMove={pendingReorder.handlePointerMove}
                onDragPointerUp={pendingReorder.handlePointerUp}
                onSortDate={() => applySort('date')}
                onSortAlpha={() => applySort('alpha')}
                onEnterCustomOrder={() => setReorderMode(true)}
                onStartEdit={() => setEditingId(item.id)}
                onSaveEdit={(val) => saveEdit(item.id, val)}
                onCancelEdit={() => setEditingId(null)}
                onToggle={toggleDone}
                onDelete={requestDelete}
                onOpenDueDate={() => setDueDateTarget(item)}
              />
            ))}

            {doneItems.length > 0 && (
              <div className="flex items-center justify-between bg-amber-900/[0.03] px-3 py-1.5 dark:bg-amber-100/[0.03]">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  {t('notes.doneSectionLabel')} ({doneItems.length})
                </p>
                {!readOnly && (
                  <button
                    onClick={() => setConfirmEmpty(true)}
                    className="text-[11px] font-medium text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                  >
                    {t('notes.emptyDone')}
                  </button>
                )}
              </div>
            )}

            {doneReorder.displayItems.map((item) => (
              <ItemRow
                key={item.id}
                item={item}
                soloList={soloList}
                editing={editingId === item.id}
                dragging={doneReorder.draggingId === item.id}
                draggable={!searching && !readOnly}
                reorderMode={reorderMode}
                readOnly={readOnly}
                onRowRef={(el) => doneReorder.registerRow(item.id, el)}
                onDragPointerDown={doneReorder.handlePointerDown(item.id)}
                onDragPointerMove={doneReorder.handlePointerMove}
                onDragPointerUp={doneReorder.handlePointerUp}
                onSortDate={() => applySort('date')}
                onSortAlpha={() => applySort('alpha')}
                onEnterCustomOrder={() => setReorderMode(true)}
                onStartEdit={() => setEditingId(item.id)}
                onSaveEdit={(val) => saveEdit(item.id, val)}
                onCancelEdit={() => setEditingId(null)}
                onToggle={toggleDone}
                onDelete={requestDelete}
                onOpenDueDate={() => setDueDateTarget(item)}
              />
            ))}
          </NotepadCard>
        </div>
      )}

      {!readOnly && (
        <button
          onClick={() => setShowAddSheet(true)}
          aria-label={t('notes.addTitle')}
          title={t('notes.addTitle')}
          className="fixed bottom-6 right-6 flex h-14 w-14 items-center justify-center rounded-full bg-brand-600 text-2xl text-white shadow-lg hover:bg-brand-700"
        >
          +
        </button>
      )}

      {lastPendingId && (
        <UndoToast message="Nota eliminada" onUndo={() => undoDelete(lastPendingId)} />
      )}

      {confirmEmpty && (
        <ConfirmDialog
          title="Vaciar comprados"
          message={`¿Eliminar definitivamente las ${doneItems.length} notas marcadas como hechas/compradas? Esta acción no se puede deshacer.`}
          confirmLabel={t('menu.delete')}
          danger
          onCancel={() => setConfirmEmpty(false)}
          onConfirm={emptyDone}
        />
      )}

      {dueDateTarget && (
        <DueDateSheet
          item={dueDateTarget}
          onClose={() => setDueDateTarget(null)}
          onSave={(date) => {
            setDueDate(dueDateTarget.id, date)
            setDueDateTarget(null)
          }}
        />
      )}

      {showAddSheet && (
        <AddNoteSheet
          content={content}
          setContent={setContent}
          submitting={submitting}
          inputRef={inputRef}
          suggestions={visibleSuggestions}
          onSubmit={addItem}
          onSuggestion={addSuggestion}
          onClose={() => setShowAddSheet(false)}
        />
      )}
    </div>
  )
}

function NotepadCard({ children, muted }: { children: ReactNode; muted?: boolean }) {
  return (
    <div
      className={`relative overflow-hidden rounded-xl shadow-sm ring-1 ${
        muted
          ? 'bg-[#faf7ee] ring-amber-100/70 dark:bg-[#26221c] dark:ring-amber-950/30'
          : 'bg-[#fffdf3] ring-amber-100 dark:bg-[#2a251e] dark:ring-amber-950/40'
      }`}
      style={{
        backgroundImage:
          'repeating-linear-gradient(to bottom, transparent, transparent 42px, rgba(180,150,90,0.16) 43px)',
        backgroundPosition: '0 4px',
      }}
    >
      <div className="pointer-events-none absolute inset-y-0 left-9 hidden w-px bg-red-200/60 sm:block dark:bg-red-900/30" />
      <div className="divide-y divide-amber-900/5 dark:divide-amber-100/5">{children}</div>
    </div>
  )
}

const COMMA_HINT_KEY = 'listas-en-comun-comma-hint-dismissed'

function AddNoteSheet({
  content,
  setContent,
  submitting,
  inputRef,
  suggestions,
  onSubmit,
  onSuggestion,
  onClose,
}: {
  content: string
  setContent: (v: string) => void
  submitting: boolean
  inputRef: RefObject<HTMLInputElement | null>
  suggestions: ItemSuggestion[]
  onSubmit: (e: FormEvent) => void
  onSuggestion: (s: ItemSuggestion) => void
  onClose: () => void
}) {
  const { t } = useLanguage()
  const [showHint, setShowHint] = useState(
    () => typeof window !== 'undefined' && window.localStorage.getItem(COMMA_HINT_KEY) !== '1',
  )
  const dismissHint = () => {
    setShowHint(false)
    window.localStorage.setItem(COMMA_HINT_KEY, '1')
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-t-2xl bg-white p-6 shadow-xl sm:rounded-2xl dark:bg-[var(--color-surface)]"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-lg font-semibold text-slate-900 dark:text-slate-100">{t('notes.addTitle')}</h2>

        {showHint && (
          <div className="mb-3 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
            <span className="flex-1">
              💡 Truco: puedes escribir varias notas separadas por comas (ej. "Huevos, calamares, pan") y se
              añaden todas a la vez.
            </span>
            <button
              onClick={dismissHint}
              className="shrink-0 whitespace-nowrap font-medium underline hover:no-underline"
            >
              No volver a mostrar
            </button>
          </div>
        )}

        <form onSubmit={onSubmit} className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            autoFocus
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={t('notes.addPlaceholder')}
            className="flex-1 rounded-lg border border-slate-300 px-3 py-2.5 text-base focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 dark:border-[var(--color-surface-border)] dark:bg-[var(--color-surface-alt)] dark:text-slate-100"
          />
          <button
            type="submit"
            disabled={submitting || !content.trim()}
            className="rounded-lg bg-brand-600 px-4 py-2.5 font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {t('common.add')}
          </button>
        </form>

        {suggestions.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {suggestions.map((s) => (
              <button
                key={s.id}
                onClick={() => onSuggestion(s)}
                className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-600 transition hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700 dark:border-[var(--color-surface-border)] dark:bg-[var(--color-surface)] dark:text-slate-300 dark:hover:border-brand-700 dark:hover:bg-brand-950/40 dark:hover:text-brand-400"
              >
                {s.content}
              </button>
            ))}
          </div>
        )}

        <button
          onClick={onClose}
          className="mt-5 w-full rounded-lg border border-slate-300 px-4 py-2.5 font-medium text-slate-700 hover:bg-slate-50 dark:border-[var(--color-surface-border)] dark:text-slate-200 dark:hover:bg-slate-700"
        >
          {t('common.done')}
        </button>
      </div>
    </div>
  )
}

function DueDateSheet({
  item,
  onClose,
  onSave,
}: {
  item: Item
  onClose: () => void
  onSave: (date: string | null) => void
}) {
  const [value, setValue] = useState(item.due_date ?? '')

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-t-2xl bg-white p-6 shadow-xl sm:rounded-2xl dark:bg-[var(--color-surface)]"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-1 text-lg font-semibold text-slate-900 dark:text-slate-100">Fecha límite</h2>
        <p className="mb-4 truncate text-sm text-slate-500 dark:text-slate-400">{item.content}</p>
        <input
          type="date"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="mb-5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-base focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 dark:border-[var(--color-surface-border)] dark:bg-[var(--color-surface-alt)] dark:text-slate-100"
        />
        <div className="flex gap-3">
          {item.due_date && (
            <button
              onClick={() => onSave(null)}
              className="flex-1 rounded-lg border border-slate-300 px-4 py-2.5 font-medium text-slate-700 hover:bg-slate-50 dark:border-[var(--color-surface-border)] dark:text-slate-200 dark:hover:bg-slate-700"
            >
              Quitar fecha
            </button>
          )}
          <button
            onClick={() => onSave(value || null)}
            disabled={!value}
            className="flex-1 rounded-lg bg-brand-600 px-4 py-2.5 font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            Guardar
          </button>
        </div>
      </div>
    </div>
  )
}

function ItemRow({
  item,
  soloList,
  editing,
  dragging,
  draggable,
  reorderMode,
  readOnly,
  onRowRef,
  onDragPointerDown,
  onDragPointerMove,
  onDragPointerUp,
  onSortDate,
  onSortAlpha,
  onEnterCustomOrder,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onToggle,
  onDelete,
  onOpenDueDate,
}: {
  item: Item
  soloList: boolean
  editing: boolean
  dragging: boolean
  draggable: boolean
  reorderMode?: boolean
  readOnly?: boolean
  onRowRef: (el: HTMLElement | null) => void
  onDragPointerDown: (e: ReactPointerEvent) => void
  onDragPointerMove: (e: ReactPointerEvent) => void
  onDragPointerUp: (e: ReactPointerEvent) => void
  onSortDate?: () => void
  onSortAlpha?: () => void
  onEnterCustomOrder?: () => void
  onStartEdit: () => void
  onSaveEdit: (value: string) => void
  onCancelEdit: () => void
  onToggle: (item: Item) => void
  onDelete: (id: string) => void
  onOpenDueDate: () => void
}) {
  const { t } = useLanguage()
  const [draft, setDraft] = useState(item.content)
  const [showMenu, setShowMenu] = useState(false)
  const [showSortMenu, setShowSortMenu] = useState(false)
  const longPress = useLongPress(() => setShowMenu(true))

  const startEdit = () => {
    setDraft(item.content)
    onStartEdit()
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') onSaveEdit(draft)
    if (e.key === 'Escape') onCancelEdit()
  }

  const overdue = !!item.due_date && !item.done && item.due_date < todayISO()
  const dueToday = !!item.due_date && !item.done && item.due_date === todayISO()
  const inReorder = draggable && !!reorderMode

  return (
    <div
      ref={onRowRef}
      onPointerDown={inReorder ? onDragPointerDown : undefined}
      onPointerMove={inReorder ? onDragPointerMove : undefined}
      onPointerUp={inReorder ? onDragPointerUp : undefined}
      aria-label={inReorder ? t('lists.dragHandle') : undefined}
      className={`px-3 py-2.5 sm:pl-11 ${inReorder ? 'touch-none select-none' : ''} ${
        dragging ? 'relative shadow-md ring-1 ring-brand-200 bg-amber-50/80 dark:bg-amber-950/20' : ''
      }`}
      style={inReorder ? { cursor: 'grab' } : undefined}
    >
      <div className="flex items-center gap-3">
        {inReorder && (
          <span className="shrink-0 text-slate-300 dark:text-slate-600" aria-hidden="true">
            ⠿
          </span>
        )}
        <input
          type="checkbox"
          checked={item.done}
          disabled={readOnly || inReorder}
          onChange={() => !readOnly && !inReorder && onToggle(item)}
          className="h-5 w-5 shrink-0 rounded border-slate-300 accent-green-600 focus:ring-green-500 disabled:opacity-60"
        />
        <div className="min-w-0 flex-1" {...(!editing && !inReorder ? longPress : {})}>
          {editing ? (
            <input
              type="text"
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={() => onSaveEdit(draft)}
              className="w-full rounded border border-brand-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-brand-100 dark:bg-[var(--color-surface-alt)] dark:text-slate-100"
            />
          ) : (
            <p
              onClick={readOnly || inReorder ? undefined : startEdit}
              className={`truncate text-sm ${item.done ? 'text-slate-400 line-through decoration-slate-300' : readOnly ? 'text-slate-800 dark:text-slate-100' : 'cursor-text text-slate-800 dark:text-slate-100'}`}
            >
              {item.content}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-x-2">
            {!soloList && item.creator?.username && (
              <p className="flex items-center gap-1.5 truncate text-xs text-slate-400">
                <Avatar username={item.creator.username} avatarUrl={item.creator.avatar_url} size={16} />
                {t('notes.addedBy')} {item.creator.username}
              </p>
            )}
            {item.due_date && (
              <span
                className={`text-xs ${
                  overdue
                    ? 'font-medium text-red-500 dark:text-red-400'
                    : dueToday
                      ? 'font-medium text-amber-600 dark:text-amber-400'
                      : 'text-slate-400'
                }`}
              >
                {t('notes.due')}: {formatDueDate(item.due_date)}
              </span>
            )}
          </div>
        </div>
      </div>

      {showMenu && (
        <ContextMenu
          onClose={() => setShowMenu(false)}
          actions={[
            ...(!readOnly
              ? [
                  { label: t('menu.editNote'), icon: '✎', onSelect: startEdit },
                  { label: t('menu.dueDate'), icon: '📅', onSelect: onOpenDueDate },
                ]
              : []),
            ...(!readOnly && onSortDate && onSortAlpha && onEnterCustomOrder
              ? [{ label: t('menu.reorder'), icon: '↕️', onSelect: () => setShowSortMenu(true) }]
              : []),
            { label: t('menu.delete'), icon: '🗑', danger: true, onSelect: () => onDelete(item.id) },
          ]}
        />
      )}

      {!readOnly && showSortMenu && onSortDate && onSortAlpha && onEnterCustomOrder && (
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
