import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { useLongPress } from '../hooks/useLongPress'
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

export default function ItemsPanel({ listId, items, soloList }: { listId: string; items: Item[]; soloList: boolean }) {
  const { user } = useAuth()
  const [content, setContent] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [dueDateTarget, setDueDateTarget] = useState<Item | null>(null)
  const [confirmEmpty, setConfirmEmpty] = useState(false)
  const [suggestions, setSuggestions] = useState<ItemSuggestion[]>([])
  const [search, setSearch] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const [pendingDeleteIds, setPendingDeleteIds] = useState<Set<string>>(new Set())
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const [lastPendingId, setLastPendingId] = useState<string | null>(null)

  const notDeleted = items.filter((i) => !pendingDeleteIds.has(i.id))
  const visibleItems = search.trim()
    ? notDeleted.filter((i) => normalize(i.content).includes(normalize(search)))
    : notDeleted
  const doneItems = visibleItems.filter((i) => i.done)
  const pendingItems = visibleItems.filter((i) => !i.done)

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
    await createItem(content)
    setContent('')
    setSubmitting(false)
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
      <form onSubmit={addItem} className="mb-3 flex gap-2">
        <input
          ref={inputRef}
          type="text"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Añadir nota…"
          className="flex-1 rounded-lg border border-slate-300 px-3 py-2.5 text-base focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
        />
        <button
          type="submit"
          disabled={submitting || !content.trim()}
          className="rounded-lg bg-brand-600 px-4 py-2.5 font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          Añadir
        </button>
      </form>

      {visibleSuggestions.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {visibleSuggestions.map((s) => (
            <button
              key={s.id}
              onClick={() => addSuggestion(s)}
              className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-600 transition hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-brand-700 dark:hover:bg-brand-950/40 dark:hover:text-brand-400"
            >
              {s.content}
            </button>
          ))}
        </div>
      )}

      {items.length > SEARCH_THRESHOLD && (
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar en esta lista…"
          className="mb-4 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
        />
      )}

      {visibleItems.length === 0 ? (
        search.trim() ? (
          <p className="py-8 text-center text-sm text-slate-400">No hay notas que coincidan con la búsqueda.</p>
        ) : (
          <div className="py-8 text-center">
            <p className="mb-4 text-sm text-slate-400">Todavía no hay notas en esta lista.</p>
            <button
              onClick={() => inputRef.current?.focus()}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
            >
              ➕ Añadir tu primera nota
            </button>
          </div>
        )
      ) : (
        <div className="space-y-4">
          {pendingItems.length > 0 && (
            <div>
              <div className="mb-2 flex justify-end">
                <button
                  onClick={markAllDone}
                  className="text-xs font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400"
                >
                  ✓ Marcar todas como hechas
                </button>
              </div>
              <div className="overflow-hidden rounded-lg bg-white shadow-sm ring-1 ring-slate-200 dark:bg-slate-800 dark:ring-slate-700">
                <div className="divide-y divide-slate-100 dark:divide-slate-700">
                  {pendingItems.map((item) => (
                    <ItemRow
                      key={item.id}
                      item={item}
                      soloList={soloList}
                      editing={editingId === item.id}
                      onStartEdit={() => setEditingId(item.id)}
                      onSaveEdit={(val) => saveEdit(item.id, val)}
                      onCancelEdit={() => setEditingId(null)}
                      onToggle={toggleDone}
                      onDelete={requestDelete}
                      onOpenDueDate={() => setDueDateTarget(item)}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}

          {doneItems.length > 0 && (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Hechos / comprados ({doneItems.length})
                </p>
                <button onClick={() => setConfirmEmpty(true)} className="text-xs font-medium text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300">
                  🗑 Vaciar comprados
                </button>
              </div>
              <div className="overflow-hidden rounded-lg bg-white shadow-sm ring-1 ring-slate-200 dark:bg-slate-800 dark:ring-slate-700">
                <div className="divide-y divide-slate-100 dark:divide-slate-700">
                  {doneItems.map((item) => (
                    <ItemRow
                      key={item.id}
                      item={item}
                      soloList={soloList}
                      editing={editingId === item.id}
                      onStartEdit={() => setEditingId(item.id)}
                      onSaveEdit={(val) => saveEdit(item.id, val)}
                      onCancelEdit={() => setEditingId(null)}
                      onToggle={toggleDone}
                      onDelete={requestDelete}
                      onOpenDueDate={() => setDueDateTarget(item)}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {lastPendingId && (
        <UndoToast message="Nota eliminada" onUndo={() => undoDelete(lastPendingId)} />
      )}

      {confirmEmpty && (
        <ConfirmDialog
          title="Vaciar comprados"
          message={`¿Eliminar definitivamente las ${doneItems.length} notas marcadas como hechas/compradas? Esta acción no se puede deshacer.`}
          confirmLabel="Eliminar"
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
        className="w-full max-w-sm rounded-t-2xl bg-white p-6 shadow-xl sm:rounded-2xl dark:bg-slate-800"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-1 text-lg font-semibold text-slate-900 dark:text-slate-100">Fecha límite</h2>
        <p className="mb-4 truncate text-sm text-slate-500 dark:text-slate-400">{item.content}</p>
        <input
          type="date"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="mb-5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-base focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
        />
        <div className="flex gap-3">
          {item.due_date && (
            <button
              onClick={() => onSave(null)}
              className="flex-1 rounded-lg border border-slate-300 px-4 py-2.5 font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
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
  onStartEdit: () => void
  onSaveEdit: (value: string) => void
  onCancelEdit: () => void
  onToggle: (item: Item) => void
  onDelete: (id: string) => void
  onOpenDueDate: () => void
}) {
  const [draft, setDraft] = useState(item.content)
  const [showMenu, setShowMenu] = useState(false)
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

  return (
    <div className="px-3 py-2.5">
      <div className="flex items-center gap-3">
        <input
          type="checkbox"
          checked={item.done}
          onChange={() => onToggle(item)}
          className="h-5 w-5 shrink-0 rounded border-slate-300 accent-green-600 focus:ring-green-500"
        />
        <div className="min-w-0 flex-1" {...(!editing ? longPress : {})}>
          {editing ? (
            <input
              type="text"
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={() => onSaveEdit(draft)}
              className="w-full rounded border border-brand-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-brand-100 dark:bg-slate-900 dark:text-slate-100"
            />
          ) : (
            <p
              onClick={startEdit}
              className={`truncate text-sm ${item.done ? 'text-slate-400' : 'cursor-text text-slate-800 dark:text-slate-100'}`}
            >
              {item.content}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-x-2">
            {!soloList && item.creator?.username && (
              <p className="flex items-center gap-1.5 truncate text-xs text-slate-400">
                <Avatar username={item.creator.username} avatarUrl={item.creator.avatar_url} size={16} />
                Añadido por {item.creator.username}
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
                Vence: {formatDueDate(item.due_date)}
              </span>
            )}
          </div>
        </div>
      </div>

      {showMenu && (
        <ContextMenu
          onClose={() => setShowMenu(false)}
          actions={[
            { label: 'Editar', icon: '✎', onSelect: startEdit },
            { label: 'Fecha límite', icon: '📅', onSelect: onOpenDueDate },
            { label: 'Eliminar', icon: '🗑', danger: true, onSelect: () => onDelete(item.id) },
          ]}
        />
      )}
    </div>
  )
}
