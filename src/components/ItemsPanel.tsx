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

function formatDueDate(dateStr: string, language: 'es' | 'en' = 'es') {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(language === 'en' ? 'en-US' : 'es-ES', {
    day: 'numeric',
    month: 'short',
  })
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
  onCompleteList,
}: {
  listId: string
  items: Item[]
  soloList: boolean
  readOnly?: boolean
  // Solo se pasa cuando quien mira la lista puede completarla (el dueño, y
  // la lista no está ya completada) — así el botón de abajo solo aparece
  // quien puede pulsarlo de verdad. Abre la misma confirmación que el botón
  // ✓ de la cabecera, para no duplicar esa lógica.
  onCompleteList?: () => void
}) {
  const { user } = useAuth()
  const { t, language } = useLanguage()
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
  // Mientras se arrastra una nota, la tarjeta deja de recortar lo que se
  // sale de su marco (ver NotepadCard) — si no, en cuanto la nota se
  // arrastraba más arriba/abajo/a los lados del propio recuadro, se volvía
  // invisible de golpe aunque siguiera seguiendo al dedo por dentro, dando
  // la sensación de que el arrastre se quedaba "pillado" ahí.
  const isDraggingItem = !!(pendingReorder.draggingId || doneReorder.draggingId)

  const applySort = async (criterion: 'date' | 'alpha') => {
    const sortFn = (a: Item, b: Item) =>
      criterion === 'alpha'
        ? a.content.localeCompare(b.content, language === 'en' ? 'en' : 'es')
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
          className="mb-4 w-full rounded-lg border px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 border-[var(--color-surface-border)] bg-[var(--color-surface)] dark:text-slate-100"
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

          <NotepadCard isDragging={isDraggingItem}>
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
              // h-10 (40px) a propósito, no padding vertical suelto: la
              // rayita de fondo de la hoja (ver NotepadCard) se repite cada
              // 40px desde arriba de toda la tarjeta, así que si esta franja
              // no mide EXACTAMENTE 40px, todo lo que va después (las notas
              // ya hechas) queda desplazado respecto a esas rayitas — se ve
              // como si los márgenes de las notas hechas no coincidieran con
              // los de las pendientes, aunque las filas en sí midan igual.
              <div className="flex h-10 items-center justify-between bg-[var(--color-surface-alt)] px-3">
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

          {/* Cuando ya está todo marcado, no hace falta ir a buscar el ✓
              pequeño de la cabecera — se ofrece completar la lista aquí
              mismo, justo donde ya estás mirando. No se muestra mientras se
              busca (con el filtro activo "todo hecho" puede ser solo un
              efecto del filtro, no que la lista entera esté acabada). */}
          {!readOnly && !searching && onCompleteList && doneItems.length > 0 && pendingItems.length === 0 && (
            <button
              onClick={onCompleteList}
              className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-brand-300 bg-brand-50 px-4 py-3 text-sm font-semibold text-brand-700 hover:bg-brand-100 dark:border-brand-700 dark:bg-brand-950/30 dark:text-brand-400 dark:hover:bg-brand-950/50"
            >
              ✓ {t('notes.completeListCta')}
            </button>
          )}
        </div>
      )}

      {!readOnly && (
        <button
          onClick={() => setShowAddSheet(true)}
          aria-label={t('notes.addTitle')}
          title={t('notes.addTitle')}
          className="fixed bottom-6 right-6 flex h-14 w-14 items-center justify-center rounded-full bg-brand-600 text-2xl text-white shadow-lg ring-2 ring-white/40 dark:shadow-2xl dark:shadow-black/50 dark:ring-white/15 hover:bg-brand-700"
        >
          +
        </button>
      )}

      {lastPendingId && (
        <UndoToast message={t('notes.deletedToast')} onUndo={() => undoDelete(lastPendingId)} />
      )}

      {confirmEmpty && (
        <ConfirmDialog
          title={t('notes.emptyDone')}
          message={t('notes.emptyDoneConfirm', { count: doneItems.length })}
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

function NotepadCard({ children, isDragging }: { children: ReactNode; isDragging?: boolean }) {
  return (
    <div
      className={`relative rounded-xl bg-[var(--color-surface)] shadow-sm ring-1 ring-[var(--color-surface-border)] ${
        isDragging ? 'overflow-visible' : 'overflow-hidden'
      }`}
      style={{
        // 40px = la altura real de una fila sencilla (2.5 de padding arriba
        // y abajo + una línea de texto), para que la rayita caiga justo en
        // el borde entre una nota y la siguiente en el caso más común. Con
        // notas de dos líneas, fecha límite o el nombre de quien la añadió
        // la fila mide más, así que a partir de ahí puede desajustarse un
        // poco — es un patrón decorativo, no algo pensado para encajar a la
        // perfección con cualquier alto de fila.
        backgroundImage:
          'repeating-linear-gradient(to bottom, transparent, transparent 39px, var(--color-surface-line) 40px)',
        backgroundPosition: '0 0',
      }}
    >
      {/* margen izquierdo, como en una hoja pautada */}
      <div className="pointer-events-none absolute inset-y-0 left-9 hidden w-px bg-[var(--color-surface-line)] sm:block" />
      {/* dobladillo en la esquina superior derecha, como una hoja doblada */}
      <div
        className="pointer-events-none absolute right-0 top-0 h-4 w-4"
        style={{
          background: 'linear-gradient(135deg, transparent 50%, var(--color-surface-alt) 50%)',
          boxShadow: '-1px 1px 3px rgba(0,0,0,0.18)',
        }}
        aria-hidden="true"
      />
      <div>{children}</div>
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
        className="w-full max-w-md rounded-t-2xl p-6 shadow-xl sm:rounded-2xl bg-[var(--color-surface)]"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-lg font-semibold text-slate-900 dark:text-slate-100">{t('notes.addTitle')}</h2>

        {showHint && (
          <div className="mb-3 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
            <span className="flex-1">{t('notes.commaHint')}</span>
            <button
              onClick={dismissHint}
              className="shrink-0 whitespace-nowrap font-medium underline hover:no-underline"
            >
              {t('notes.commaHintDismiss')}
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
            className="flex-1 rounded-lg border px-3 py-2.5 text-base focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 border-[var(--color-surface-border)] bg-[var(--color-surface-alt)] dark:text-slate-100"
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
                className="rounded-full border px-3 py-1 text-xs text-slate-600 transition hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700 border-[var(--color-surface-border)] bg-[var(--color-surface)] dark:text-slate-300 dark:hover:border-brand-700 dark:hover:bg-brand-950/40 dark:hover:text-brand-400"
              >
                {s.content}
              </button>
            ))}
          </div>
        )}

        <button
          onClick={onClose}
          className="mt-5 w-full rounded-lg border px-4 py-2.5 font-medium text-slate-700 hover:bg-slate-50 border-[var(--color-surface-border)] dark:text-slate-200 dark:hover:bg-slate-700"
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
  const { t } = useLanguage()
  const [value, setValue] = useState(item.due_date ?? '')

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-t-2xl p-6 shadow-xl sm:rounded-2xl bg-[var(--color-surface)]"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-1 text-lg font-semibold text-slate-900 dark:text-slate-100">{t('menu.dueDate')}</h2>
        <p className="mb-4 truncate text-sm text-slate-500 dark:text-slate-400">{item.content}</p>
        <input
          type="date"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="mb-5 w-full rounded-lg border px-3 py-2.5 text-base focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 border-[var(--color-surface-border)] bg-[var(--color-surface-alt)] dark:text-slate-100"
        />
        <div className="flex gap-3">
          {item.due_date && (
            <button
              onClick={() => onSave(null)}
              className="flex-1 rounded-lg border px-4 py-2.5 font-medium text-slate-700 hover:bg-slate-50 border-[var(--color-surface-border)] dark:text-slate-200 dark:hover:bg-slate-700"
            >
              {t('notes.removeDueDate')}
            </button>
          )}
          <button
            onClick={() => onSave(value || null)}
            disabled={!value}
            className="flex-1 rounded-lg bg-brand-600 px-4 py-2.5 font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {t('common.save')}
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
  const { t, language } = useLanguage()
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
  // Para que la nota ocupe siempre un múltiplo exacto de una "línea" de la
  // hoja (40px), en vez de dejar que el padding del contenedor añada una
  // altura suelta que no encaja en la rejilla, apoyamos toda la altura en
  // el interlineado del propio texto (leading-[40px] más abajo) y, si hay
  // una segunda línea (fecha límite), le damos también exactamente una
  // línea completa. Así, una nota con texto largo que ocupa dos líneas
  // empuja a las de abajo exactamente 2 líneas, y todo sigue cuadrando con
  // las rayitas del fondo. Quién la añadió ya no ocupa su propia línea —
  // ahora es solo una foto pegada al lateral derecho del propio texto (ver
  // más abajo).
  const hasSecondaryLine = !!item.due_date

  return (
    <div
      ref={onRowRef}
      className={`px-3 sm:pl-11 ${
        dragging ? 'relative shadow-md ring-1 ring-brand-200 bg-[var(--color-surface-alt)]' : ''
      }`}
    >
      <div className="flex items-start gap-3">
        {/* Casilla (y el asa ⠿) fijas a 40px de alto, para que queden a la
            altura de la primera línea de la nota y no floten a medio camino
            cuando el texto ocupa varias líneas. */}
        <div className="flex h-10 shrink-0 items-center gap-3">
          {inReorder && (
            // El asa es lo único que arrastra — el resto de la fila queda
            // libre para hacer scroll con normalidad, como si no estuvieras
            // en modo reordenar. touch-none va puesto aquí de forma estática
            // (no reactiva) porque tiene que estar ya así desde antes de que
            // toques la pantalla para que el navegador lo respete desde el
            // primer instante.
            <button
              type="button"
              onPointerDown={onDragPointerDown}
              onPointerMove={onDragPointerMove}
              onPointerUp={onDragPointerUp}
              // Por si el navegador cancela el gesto por su cuenta (raro con
              // touch-action:none puesto bien, pero puede pasar por cosas
              // ajenas a nosotros) — sin esto la nota se podía quedar
              // "pillada" en arrastre para siempre porque nunca llegaba un
              // pointerup. Se trata igual que soltar el dedo normal.
              onPointerCancel={onDragPointerUp}
              aria-label={t('lists.dragHandle')}
              className="-m-2 select-none p-2 text-slate-300 touch-none dark:text-slate-600"
              style={{ cursor: 'grab' }}
            >
              ⠿
            </button>
          )}
          <input
            type="checkbox"
            checked={item.done}
            disabled={readOnly || inReorder}
            onChange={() => !readOnly && !inReorder && onToggle(item)}
            className="h-5 w-5 shrink-0 rounded border-slate-300 accent-green-600 focus:ring-green-500 disabled:opacity-60"
          />
        </div>
        <div className="min-w-0 flex-1" {...(!editing && !inReorder ? longPress : {})}>
          {editing ? (
            <input
              type="text"
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={() => onSaveEdit(draft)}
              className="w-full rounded border border-brand-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-brand-100 bg-[var(--color-surface-alt)] dark:text-slate-100"
            />
          ) : (
            // El texto y la foto de quién la añadió van en la misma fila:
            // items-end hace que la foto quede pegada al lateral derecho de
            // la ÚLTIMA línea del texto (no de la primera), tanto si la nota
            // cabe en una sola línea (foto a la misma altura, a la derecha)
            // como si el texto es largo y ocupa varias (foto abajo del
            // todo, a la derecha).
            <div className="flex items-end gap-2">
              <p
                onClick={readOnly || inReorder ? undefined : startEdit}
                className={`min-w-0 flex-1 break-words text-sm leading-[40px] ${item.done ? 'text-slate-400 line-through decoration-slate-300' : readOnly ? 'text-slate-800 dark:text-slate-100' : 'cursor-text text-slate-800 dark:text-slate-100'}`}
              >
                {item.content}
              </p>
              {!soloList && item.creator?.username && (
                <Avatar
                  username={item.creator.username}
                  avatarUrl={item.creator.avatar_url}
                  size={22}
                  className="mb-2 shrink-0"
                />
              )}
            </div>
          )}
          <div className={`flex flex-wrap items-center gap-x-2 ${hasSecondaryLine ? 'h-10' : ''}`}>
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
                {t('notes.due')}: {formatDueDate(item.due_date, language)}
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
