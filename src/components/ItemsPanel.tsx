import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../lib/i18n'
import { useLongPress } from '../hooks/useLongPress'
import { useDragReorder } from '../hooks/useDragReorder'
import { formatCurrency } from '../lib/balances'
import { currencySymbol, type CurrencyCode } from '../lib/currencies'
import {
  ITEM_CATEGORY_ORDER,
  ITEM_CATEGORY_META,
  detectItemCategory,
  itemCategoryOf,
  type ItemCategoryId,
} from '../lib/itemCategories'
import Avatar from './Avatar'
import UndoToast from './UndoToast'
import ConfirmDialog from './ConfirmDialog'
import ContextMenu from './ContextMenu'
import NewExpenseModal from './NewExpenseModal'
import {
  CalendarIcon,
  CheckIcon,
  DragHandleIcon,
  EditIcon,
  LockIcon,
  PriceIcon,
  ReorderIcon,
  SortAlphaIcon,
  SortDateIcon,
  TrashIcon,
} from './icons'
import type { Item, ItemSuggestion, ListMember } from '../lib/types'

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
  currency,
  members,
  expensesEnabled,
  onCompleteList,
}: {
  listId: string
  items: Item[]
  soloList: boolean
  readOnly?: boolean
  // Los 3 siguientes son solo para "crear gasto con lo comprado" — ver más
  // abajo. La lista de la compra no necesitaba saber nada de esto hasta
  // ahora, así que son props nuevas.
  currency: CurrencyCode
  members: ListMember[]
  expensesEnabled: boolean
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
  const [priceTarget, setPriceTarget] = useState<Item | null>(null)
  const [showConvert, setShowConvert] = useState(false)
  const [confirmEmpty, setConfirmEmpty] = useState(false)
  const [suggestions, setSuggestions] = useState<ItemSuggestion[]>([])
  const [search, setSearch] = useState('')
  const [showAddSheet, setShowAddSheet] = useState(false)
  const [reorderMode, setReorderMode] = useState(false)
  const [collapsedCategories, setCollapsedCategories] = useState<Set<ItemCategoryId>>(new Set())
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

  // "Categorías vivas": mientras se busca o se está reordenando a mano, se
  // enseña la vista plana de siempre (para no complicar el arrastre ni el
  // escaneo de resultados de búsqueda) — el agrupado solo se ve en la vista
  // normal, en reposo.
  const groupedView = !searching && !reorderMode
  const categoryBuckets = useMemo(() => {
    const buckets = new Map<ItemCategoryId, { id: ItemCategoryId; items: Item[] }>()
    for (const id of ITEM_CATEGORY_ORDER) buckets.set(id, { id, items: [] })
    for (const item of [...pendingItems, ...doneItems]) {
      buckets.get(itemCategoryOf(item.category))!.items.push(item)
    }
    return ITEM_CATEGORY_ORDER.map((id) => buckets.get(id)!).filter((b) => b.items.length > 0)
  }, [pendingItems, doneItems])

  const toggleCategoryCollapsed = (id: ItemCategoryId) => {
    setCollapsedCategories((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Para el total y el botón de "crear gasto" usamos SIEMPRE la lista
  // completa (notDeleted), no la filtrada por la búsqueda — así no se
  // esconden ni cambian mientras escribes en el buscador.
  const pricedItems = useMemo(() => notDeleted.filter((i) => i.price != null), [notDeleted])
  const totalPriced = useMemo(() => pricedItems.reduce((sum, i) => sum + Number(i.price), 0), [pricedItems])
  const doneBoughtItems = useMemo(() => notDeleted.filter((i) => i.done && i.price != null), [notDeleted])
  const doneBoughtTotal = useMemo(
    () => doneBoughtItems.reduce((sum, i) => sum + Number(i.price), 0),
    [doneBoughtItems],
  )

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
    await supabase
      .from('items')
      .insert({ list_id: listId, content: trimmed, created_by: user.id, category: detectItemCategory(trimmed) })
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

  const setPrice = async (itemId: string, price: number | null) => {
    await supabase.from('items').update({ price }).eq('id', itemId)
  }

  // Al crear el gasto a partir de lo comprado, quitamos el precio de esas
  // notas para que no se puedan volver a convertir sin querer en un
  // segundo gasto duplicado — la nota se queda tal cual (marcada como
  // hecha), solo se limpia el precio.
  const clearBoughtPrices = async () => {
    await supabase
      .from('items')
      .update({ price: null })
      .eq('list_id', listId)
      .eq('done', true)
      .not('price', 'is', null)
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
      {/* Total de lo que lleva precio puesto (comprado o no) — pensado como
          un presupuesto de la lista, no como el gasto ya hecho (eso es
          "doneBoughtTotal", que es lo que se usa al crear el gasto). */}
      {pricedItems.length > 0 && (
        <div className="glass-panel mb-4 flex items-baseline justify-between rounded-2xl px-4 py-3">
          <span className="text-sm font-medium text-slate-500 dark:text-slate-400">{t('notes.priceTotal')}</span>
          <span className="text-lg font-bold text-slate-900 dark:text-slate-100">
            {formatCurrency(totalPriced, currency, language)}
          </span>
        </div>
      )}

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
            <p className="flex items-center gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
              <LockIcon className="h-3.5 w-3.5 shrink-0" />
              {t('notes.readOnlyHint')}
            </p>
          )}
          {!readOnly &&
            (pendingItems.length > 0 ||
              (expensesEnabled && doneBoughtItems.length > 0) ||
              (groupedView && doneItems.length > 0)) && (
              <div className="mb-2 flex flex-wrap items-center justify-end gap-2">
                {/* Convierte de un toque lo ya comprado (marcado + con precio)
                    en un gasto, con el importe y una descripción con los
                    productos ya rellenos — pero siempre abre el formulario
                    para revisar antes de guardar, igual que el resto de
                    gastos, nunca se crea solo. */}
                {expensesEnabled && doneBoughtItems.length > 0 && (
                  <button
                    onClick={() => setShowConvert(true)}
                    className="rounded-lg border border-brand-300 px-3 py-1.5 text-xs font-medium text-brand-700 hover:bg-brand-50 dark:border-transparent dark:bg-brand-600 dark:text-white dark:hover:bg-brand-700"
                  >
                    {t('notes.createExpenseFromDone')}
                  </button>
                )}
                {pendingItems.length > 0 && (
                  <button
                    onClick={markAllDone}
                    // Mismo patrón que el botón "+Invitar" (ver ListDetailPage):
                    // relleno, no texto suelto sobre el fondo — así siempre hay
                    // contraste de sobra, elijas el acento que elijas.
                    className="rounded-lg border border-brand-300 px-3 py-1.5 text-xs font-medium text-brand-700 hover:bg-brand-50 dark:border-transparent dark:bg-brand-600 dark:text-white dark:hover:bg-brand-700"
                  >
                    {t('notes.markAllDone')}
                  </button>
                )}
                {/* En la vista agrupada por categoría ya no hay un único
                    divisor "Hecho" al final (cada categoría enseña sus
                    propias notas compradas mezcladas con las pendientes) —
                    así que "vaciar comprados" se mueve aquí arriba, junto al
                    resto de acciones globales de la lista. En la vista plana
                    (buscando o reordenando) se sigue viendo donde siempre,
                    en su propio divisor dentro de la tarjeta. */}
                {groupedView && doneItems.length > 0 && (
                  <button
                    onClick={() => setConfirmEmpty(true)}
                    className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/30"
                  >
                    {t('notes.emptyDone')}
                  </button>
                )}
              </div>
            )}

          {groupedView ? (
            <div className="space-y-2.5">
              {categoryBuckets.map((bucket) => {
                const meta = ITEM_CATEGORY_META[bucket.id]
                const doneCount = bucket.items.filter((i) => i.done).length
                const total = bucket.items.length
                const collapsed = collapsedCategories.has(bucket.id)
                return (
                  <div
                    key={bucket.id}
                    className="glass-panel overflow-hidden rounded-2xl"
                  >
                    <button
                      type="button"
                      onClick={() => toggleCategoryCollapsed(bucket.id)}
                      className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left"
                    >
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ background: `var(${meta.colorVar})` }}
                        aria-hidden="true"
                      />
                      <span className="flex-1 truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                        {t(meta.labelKey)}
                      </span>
                      <span className="shrink-0 font-mono text-[11px] text-slate-400">
                        {doneCount}/{total}
                      </span>
                      <span
                        className={`shrink-0 text-[10px] text-slate-400 transition-transform ${collapsed ? '-rotate-90' : ''}`}
                        aria-hidden="true"
                      >
                        ▾
                      </span>
                    </button>
                    <div className="mx-3.5 mb-2 h-[3px] overflow-hidden rounded-full bg-black/5 dark:bg-white/10">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${total > 0 ? (doneCount / total) * 100 : 0}%`,
                          background: `var(${meta.colorVar})`,
                        }}
                      />
                    </div>
                    {!collapsed && (
                      <div>
                        {bucket.items.map((item) => (
                          <ItemRow
                            key={item.id}
                            item={item}
                            soloList={soloList}
                            editing={editingId === item.id}
                            dragging={false}
                            draggable={false}
                            readOnly={readOnly}
                            onRowRef={() => {}}
                            onDragPointerDown={() => {}}
                            onDragPointerMove={() => {}}
                            onDragPointerUp={() => {}}
                            onSortDate={() => applySort('date')}
                            onSortAlpha={() => applySort('alpha')}
                            onEnterCustomOrder={() => setReorderMode(true)}
                            onStartEdit={() => setEditingId(item.id)}
                            onSaveEdit={(val) => saveEdit(item.id, val)}
                            onCancelEdit={() => setEditingId(null)}
                            onToggle={toggleDone}
                            onDelete={requestDelete}
                            onOpenDueDate={() => setDueDateTarget(item)}
                            onOpenPrice={() => setPriceTarget(item)}
                            currency={currency}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
          // Antes, buscar o reordenar a mano hacía saltar a un diseño viejo
          // de "libreta de papel" (NotepadCard) totalmente distinto de las
          // tarjetas de cristal agrupadas por categoría de la vista normal.
          // Ahora se mantiene el mismo lenguaje visual (glass-panel): al
          // entrar en reordenar solo aparece el asa ⠿ en cada nota (ver
          // ItemRow, prop reorderMode) y la tarjeta deja de recortar el
          // contenido mientras arrastras (overflow-visible), igual que ya
          // hace ListsPage.tsx al reordenar las listas.
          <div className={`glass-panel rounded-2xl ${isDraggingItem ? 'overflow-visible' : 'overflow-hidden'}`}>
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
                onOpenPrice={() => setPriceTarget(item)}
                currency={currency}
              />
            ))}

            {doneItems.length > 0 && (
              <div className="flex items-center justify-between border-t px-3.5 py-2 border-[var(--color-glass-border)]">
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
                onOpenPrice={() => setPriceTarget(item)}
                currency={currency}
              />
            ))}
          </div>
          )}

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
              <CheckIcon className="h-4 w-4" />
              {t('notes.completeListCta')}
            </button>
          )}
        </div>
      )}

      {!readOnly && (
        <button
          onClick={() => setShowAddSheet(true)}
          aria-label={t('notes.addTitle')}
          title={t('notes.addTitle')}
          className="fixed bottom-6 right-6 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-[var(--color-brand-500)] to-[var(--color-brand-600)] text-2xl text-white shadow-[0_16px_30px_-10px_var(--color-glow)] ring-1 ring-[var(--color-glass-border)]"
        >
          +
        </button>
      )}

      {/* Botón de confirmar reordenar: en espejo con el "+" de arriba, a la
          izquierda — un atajo a mano para terminar de reordenar sin tener
          que subir hasta el aviso de arriba. Hace lo mismo que su botón
          "Listo". Solo se ve mientras se está reordenando. */}
      {!readOnly && reorderMode && (
        <button
          type="button"
          onClick={() => setReorderMode(false)}
          aria-label={t('reorder.done')}
          title={t('reorder.done')}
          className="fixed bottom-6 left-6 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-[var(--color-brand-500)] to-[var(--color-brand-600)] text-white shadow-[0_16px_30px_-10px_var(--color-glow)] ring-1 ring-[var(--color-glass-border)]"
        >
          <CheckIcon className="h-6 w-6" />
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

      {priceTarget && (
        <PriceSheet
          item={priceTarget}
          currency={currency}
          onClose={() => setPriceTarget(null)}
          onSave={(price) => {
            setPrice(priceTarget.id, price)
            setPriceTarget(null)
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

      {showConvert && (
        <NewExpenseModal
          listId={listId}
          currency={currency}
          members={members}
          initial={{
            description: t('notes.expenseDescription', {
              items:
                doneBoughtItems.length > 6
                  ? `${doneBoughtItems.slice(0, 6).map((i) => i.content).join(', ')}…`
                  : doneBoughtItems.map((i) => i.content).join(', '),
            }),
            totalAmount: doneBoughtTotal,
            category: 'compras',
          }}
          onClose={() => setShowConvert(false)}
          onCreated={async () => {
            setShowConvert(false)
            await clearBoughtPrices()
          }}
        />
      )}
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
        className="glass-panel w-full max-w-md rounded-t-[28px] p-6 shadow-[0_24px_60px_-20px_rgba(20,21,26,0.5)] sm:rounded-[28px]"
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
            className="flex-1 rounded-2xl border px-3 py-2.5 text-base focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 border-[var(--color-glass-border)] bg-[var(--color-glass)] dark:text-slate-100"
          />
          <button
            type="submit"
            disabled={submitting || !content.trim()}
            className="rounded-full bg-gradient-to-br from-[var(--color-brand-500)] to-[var(--color-brand-600)] px-4 py-2.5 font-medium text-white shadow-[0_10px_22px_-10px_var(--color-glow)] disabled:opacity-50"
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
                className="rounded-full border px-3 py-1 text-xs text-slate-600 transition hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700 border-[var(--color-glass-border)] bg-[var(--color-glass)] dark:text-slate-300 dark:hover:border-brand-700 dark:hover:bg-brand-950/40 dark:hover:text-brand-400"
              >
                {s.content}
              </button>
            ))}
          </div>
        )}

        <button
          onClick={onClose}
          className="mt-5 w-full rounded-full border px-4 py-2.5 font-medium text-slate-700 hover:bg-white/60 border-[var(--color-glass-border)] dark:text-slate-200 dark:hover:bg-white/10"
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
        className="glass-panel w-full max-w-sm rounded-t-[28px] p-6 shadow-[0_24px_60px_-20px_rgba(20,21,26,0.5)] sm:rounded-[28px]"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-1 text-lg font-semibold text-slate-900 dark:text-slate-100">{t('menu.dueDate')}</h2>
        <p className="mb-4 truncate text-sm text-slate-500 dark:text-slate-400">{item.content}</p>
        <input
          type="date"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="mb-5 w-full rounded-2xl border px-3 py-2.5 text-base focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 border-[var(--color-glass-border)] bg-[var(--color-glass)] dark:text-slate-100"
        />
        <div className="flex gap-3">
          {item.due_date && (
            <button
              onClick={() => onSave(null)}
              className="flex-1 rounded-full border px-4 py-2.5 font-medium text-slate-700 hover:bg-white/60 border-[var(--color-glass-border)] dark:text-slate-200 dark:hover:bg-white/10"
            >
              {t('notes.removeDueDate')}
            </button>
          )}
          <button
            onClick={() => onSave(value || null)}
            disabled={!value}
            className="flex-1 rounded-full bg-gradient-to-br from-[var(--color-brand-500)] to-[var(--color-brand-600)] px-4 py-2.5 font-medium text-white shadow-[0_10px_22px_-10px_var(--color-glow)] disabled:opacity-50"
          >
            {t('common.save')}
          </button>
        </div>
      </div>
    </div>
  )
}

function PriceSheet({
  item,
  currency,
  onClose,
  onSave,
}: {
  item: Item
  currency: CurrencyCode
  onClose: () => void
  onSave: (price: number | null) => void
}) {
  const { t } = useLanguage()
  const [value, setValue] = useState(item.price != null ? item.price.toFixed(2) : '')

  const parsed = Number.parseFloat(value.replace(',', '.'))
  const valid = Number.isFinite(parsed) && parsed >= 0

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div
        className="glass-panel w-full max-w-sm rounded-t-[28px] p-6 shadow-[0_24px_60px_-20px_rgba(20,21,26,0.5)] sm:rounded-[28px]"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-1 text-lg font-semibold text-slate-900 dark:text-slate-100">
          {t('menu.price')} ({currencySymbol(currency)})
        </h2>
        <p className="mb-4 truncate text-sm text-slate-500 dark:text-slate-400">{item.content}</p>
        <input
          type="text"
          inputMode="decimal"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={t('notes.pricePlaceholder')}
          className="mb-5 w-full rounded-2xl border px-3 py-2.5 text-base focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 border-[var(--color-glass-border)] bg-[var(--color-glass)] dark:text-slate-100"
        />
        <div className="flex gap-3">
          {item.price != null && (
            <button
              onClick={() => onSave(null)}
              className="flex-1 rounded-full border px-4 py-2.5 font-medium text-slate-700 hover:bg-white/60 border-[var(--color-glass-border)] dark:text-slate-200 dark:hover:bg-white/10"
            >
              {t('notes.removePrice')}
            </button>
          )}
          <button
            onClick={() => onSave(Math.round(parsed * 100) / 100)}
            disabled={!valid}
            className="flex-1 rounded-full bg-gradient-to-br from-[var(--color-brand-500)] to-[var(--color-brand-600)] px-4 py-2.5 font-medium text-white shadow-[0_10px_22px_-10px_var(--color-glow)] disabled:opacity-50"
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
  onOpenPrice,
  currency,
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
  onOpenPrice: () => void
  currency: CurrencyCode
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
  const hasSecondaryLine = !!item.due_date || item.price != null

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
            {item.price != null && (
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                {formatCurrency(item.price, currency, language)}
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
                  { label: t('menu.editNote'), icon: <EditIcon className="h-5 w-5" />, onSelect: startEdit },
                  { label: t('menu.dueDate'), icon: <CalendarIcon className="h-5 w-5" />, onSelect: onOpenDueDate },
                  {
                    label: item.price != null ? `${t('menu.price')}: ${formatCurrency(item.price, currency, language)}` : t('menu.price'),
                    icon: <PriceIcon className="h-5 w-5" />,
                    onSelect: onOpenPrice,
                  },
                ]
              : []),
            ...(!readOnly && onSortDate && onSortAlpha && onEnterCustomOrder
              ? [{ label: t('menu.reorder'), icon: <ReorderIcon className="h-5 w-5" />, onSelect: () => setShowSortMenu(true) }]
              : []),
            { label: t('menu.delete'), icon: <TrashIcon className="h-5 w-5" />, danger: true, onSelect: () => onDelete(item.id) },
          ]}
        />
      )}

      {!readOnly && showSortMenu && onSortDate && onSortAlpha && onEnterCustomOrder && (
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
