import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import Avatar from './Avatar'
import type { Item } from '../lib/types'

export default function ItemsPanel({ listId, items }: { listId: string; items: Item[] }) {
  const { user } = useAuth()
  const [content, setContent] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const doneItems = items.filter((i) => i.done)
  const pendingItems = items.filter((i) => !i.done)

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

  const deleteItem = async (itemId: string) => {
    await supabase.from('items').delete().eq('id', itemId)
  }

  const emptyDone = async () => {
    if (doneItems.length === 0) return
    if (!confirm(`¿Eliminar definitivamente los ${doneItems.length} ítems marcados como hechos/comprados?`)) return
    await supabase
      .from('items')
      .delete()
      .eq('list_id', listId)
      .eq('done', true)
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

      {items.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-400">Todavía no hay ítems en esta lista.</p>
      ) : (
        <div className="space-y-2">
          {pendingItems.map((item) => (
            <ItemRow key={item.id} item={item} onToggle={toggleDone} onDelete={deleteItem} />
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
                <ItemRow key={item.id} item={item} onToggle={toggleDone} onDelete={deleteItem} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ItemRow({
  item,
  onToggle,
  onDelete,
}: {
  item: Item
  onToggle: (item: Item) => void
  onDelete: (id: string) => void
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg bg-white px-3 py-2.5 shadow-sm ring-1 ring-slate-200">
      <input
        type="checkbox"
        checked={item.done}
        onChange={() => onToggle(item)}
        className="h-5 w-5 shrink-0 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
      />
      <div className="min-w-0 flex-1">
        <p className={`truncate text-sm ${item.done ? 'text-slate-400 line-through' : 'text-slate-800'}`}>
          {item.content}
        </p>
        {item.creator?.username && (
          <p className="flex items-center gap-1.5 truncate text-xs text-slate-400">
            <Avatar username={item.creator.username} avatarUrl={item.creator.avatar_url} size={16} />
            Añadido por {item.creator.username}
          </p>
        )}
      </div>
      {item.done && (
        <button
          onClick={() => onDelete(item.id)}
          className="shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-500"
          aria-label="Eliminar definitivamente"
          title="Eliminar definitivamente"
        >
          🗑
        </button>
      )}
    </div>
  )
}
