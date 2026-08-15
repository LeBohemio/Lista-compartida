import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'

/**
 * Reordenar una lista arrastrando una fila con un "tirador" (drag handle).
 * Mientras se arrastra, calcula la posición según el punto medio de cada
 * fila (medida en el DOM), no según una altura fija — así funciona igual
 * con filas de distinto tamaño. Al soltar, llama a onCommit con el array
 * ya reordenado para que el que lo use lo guarde donde haga falta.
 */
export function useDragReorder<T>({
  items,
  getId,
  onCommit,
}: {
  items: T[]
  getId: (item: T) => string
  onCommit: (orderedItems: T[]) => void
}) {
  const [dragOrder, setDragOrder] = useState<T[] | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const rowRefs = useRef<Map<string, HTMLElement>>(new Map())
  const baseOrderRef = useRef<T[]>(items)

  const registerRow = useCallback((id: string, el: HTMLElement | null) => {
    if (el) rowRefs.current.set(id, el)
    else rowRefs.current.delete(id)
  }, [])

  const displayItems = dragOrder ?? items

  const handlePointerDown = useCallback(
    (id: string) => (e: ReactPointerEvent) => {
      e.preventDefault()
      baseOrderRef.current = items
      setDragOrder(items)
      setDraggingId(id)
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    },
    [items],
  )

  const handlePointerMove = useCallback(
    (e: ReactPointerEvent) => {
      if (!draggingId) return
      const currentY = e.clientY
      const order = baseOrderRef.current
      const draggedIndex = order.findIndex((it) => getId(it) === draggingId)
      if (draggedIndex === -1) return

      let targetIndex = 0
      for (let i = 0; i < order.length; i++) {
        const el = rowRefs.current.get(getId(order[i]))
        if (!el) continue
        const rect = el.getBoundingClientRect()
        const mid = rect.top + rect.height / 2
        if (currentY > mid) targetIndex = i === draggedIndex ? targetIndex : i
      }
      targetIndex = Math.min(targetIndex, order.length - 1)

      if (targetIndex !== draggedIndex) {
        const next = order.slice()
        const [moved] = next.splice(draggedIndex, 1)
        next.splice(targetIndex, 0, moved)
        baseOrderRef.current = next
        setDragOrder(next)
      }
    },
    [draggingId, getId],
  )

  const handlePointerUp = useCallback(() => {
    if (!draggingId) return
    setDraggingId(null)
    const finalOrder = baseOrderRef.current
    setDragOrder(null)
    onCommit(finalOrder)
  }, [draggingId, onCommit])

  return {
    displayItems,
    draggingId,
    registerRow,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
  }
}
