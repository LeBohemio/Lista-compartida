import { useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import Avatar from './Avatar'
import UndoToast from './UndoToast'
import type { Item } from '../lib/types'

const UNDO_DELAY_MS = 5000

export default function ItemsPanel({ listId, items, soloList }: { listId: string; items: Item[]; soloList: boolean }) {
  const { user } = useAuth()
  const [content, setContent] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  const [pendingDeleteIds, setPendingDeleteIds] = useState<Set<string>>(new Set())
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const [lastPendingId, setLastPendingId] = useState<string | null>(null)

  const visibleItems = items.filter((i) => !pendingDeleteIds.has(i.id))
  const doneItems = visibleItems.filter((i) => i.done)
  const pendingItems = visibleItems.filter((i) => !i.done)

  const addItem = async (e: FormEvent) => {
    e.preventDefault()
    if (!content.trim() || !user) return
    setSubmitting(true)
    await supabase.from('items').insert({ list_id: listId, content: content.trim(), created_by: user.id })
    setContent('')
    setSubmitting(false)
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
    if (doneItems.length === 0) return
    if (!confirm(`¿Eliminar definitivamente los ${doneItems.length} ítems marcados como hechos/comprados?`)) return
    await supabase.from('items').delete().eq('list_id', listId).eq('done', true)
  }

  return (
    <div>
      <form onSubmit={addItem} className="mb-4 flex gap-2">
        <input
          type="text"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Añadir ítem…"
          className="flex-1 rounded-lg border border-slate-300 px-3 py-2.5 text-base focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
        />
        <button
          type="submit"
          disabled={submitting || !content.trim()}
          className="rounded-lg bg-brand-600 px-4 py-2.5 font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          Añadir
        </button>
      </form>

      {visibleItems.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-400">Todavía no hay ítems en esta lista.</p>
      ) : (
        <div className="space-y-2">
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
            />
          ))}

          {doneItems.length > 0 && (
            <div className="pt-4">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Hechos / comprados ({doneItems.length})
                </p>
                <button onClick={emptyDone} className="text-xs font-medium text-red-500 hover:text-red-700">
                  🗑 Vaciar comprados
                </button>
              </div>
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
                />
              ))}
            </div>
          )}
        </div>
      )}

      {lastPendingId && (
        <UndoToast message="Ítem eliminado" onUndo={() => undoDelete(lastPendingId)} />
      )}
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
}: {
  item: Item
  soloList: boolean
  editing: boolean
  onStartEdit: () => void
  onSaveEdit: (value: string) => void
  onCancelEdit: () => void
  onToggle: (item: Item) => void
  onDelete: (id: string) => void
}) {
  const [draft, setDraft] = useState(item.content)

  const startEdit = () => {
    setDraft(item.content)
    onStartEdit()
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') onSaveEdit(draft)
    if (e.key === 'Escape') onCancelEdit()
  }

  return (
    <div className="flex items-center gap-3 rounded-lg bg-white px-3 py-2.5 shadow-sm ring-1 ring-slate-200">
      <input
        type="checkbox"
        checked={item.done}
        onChange={() => onToggle(item)}
        className="h-5 w-5 shrink-0 rounded border-slate-300 accent-green-600 focus:ring-green-500"
      />
      <div className="min-w-0 flex-1">
        {editing ? (
          <input
            type="text"
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={() => onSaveEdit(draft)}
            className="w-full rounded border border-brand-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-brand-100"
          />
        ) : (
          <p
            onClick={startEdit}
            className={`truncate text-sm ${item.done ? 'text-slate-400 line-through' : 'cursor-text text-slate-800'}`}
          >
            {item.content}
          </p>
        )}
        {!soloList && item.creator?.username && (
          <p className="flex items-center gap-1.5 truncate text-xs text-slate-400">
            <Avatar username={item.creator.username} avatarUrl={item.creator.avatar_url} size={16} />
            Añadido por {item.creator.username}
          </p>
        )}
      </div>
      {!editing && (
        <button
          onClick={startEdit}
          className="shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          aria-label="Editar"
          title="Editar"
        >
          ✎
        </button>
      )}
      <button
        onClick={() => onDelete(item.id)}
        className="shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-500"
        aria-label="Eliminar"
        title="Eliminar"
      >
        🗑
      </button>
    </div>
  )
}
