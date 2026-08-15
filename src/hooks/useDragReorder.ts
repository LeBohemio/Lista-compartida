import { useCallback, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'

/**
 * Reordenar una lista arrastrando una fila entera (no hace falta un tirador
 * aparte: en modo reordenar, con pulsar y mover sobre el elemento ya vale).
 *
 * Dos cosas para que se sienta bien al tacto:
 *  1) La fila que arrastras sigue al dedo en tiempo real (transform directo
 *     sobre su nodo del DOM, sin pasar por el estado de React en cada
 *     movimiento, para que no haya tirones).
 *  2) Las demás filas, cuando les toca hacer sitio, no "saltan": se animan
 *     con la técnica FLIP (se mide su posición antes y después del cambio de
 *     orden, y se anima la diferencia con una transición corta).
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
  const prevRectsRef = useRef<Map<string, DOMRect>>(new Map())
  const dragStartYRef = useRef(0)
  const draggingIdRef = useRef<string | null>(null)

  const registerRow = useCallback((id: string, el: HTMLElement | null) => {
    if (el) rowRefs.current.set(id, el)
    else rowRefs.current.delete(id)
  }, [])

  const displayItems = dragOrder ?? items

  const captureRects = useCallback(() => {
    const map = new Map<string, DOMRect>()
    rowRefs.current.forEach((el, id) => map.set(id, el.getBoundingClientRect()))
    return map
  }, [])

  const handlePointerDown = useCallback(
    (id: string) => (e: ReactPointerEvent) => {
      e.preventDefault()
      baseOrderRef.current = items
      setDragOrder(items)
      setDraggingId(id)
      draggingIdRef.current = id
      dragStartYRef.current = e.clientY
      prevRectsRef.current = captureRects()
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
      const el = rowRefs.current.get(id)
      if (el) {
        el.style.transition = 'none'
        el.style.zIndex = '30'
        el.style.willChange = 'transform'
      }
    },
    [items, captureRects],
  )

  const handlePointerMove = useCallback(
    (e: ReactPointerEvent) => {
      const draggingId = draggingIdRef.current
      if (!draggingId) return
      const currentY = e.clientY

      // La fila que se arrastra sigue al dedo directamente, sin esperar a
      // ningún render — se siente inmediato.
      const draggedEl = rowRefs.current.get(draggingId)
      if (draggedEl) {
        const offset = currentY - dragStartYRef.current
        draggedEl.style.transform = `translateY(${offset}px) scale(1.02)`
      }

      const order = baseOrderRef.current
      const draggedIndex = order.findIndex((it) => getId(it) === draggingId)
      if (draggedIndex === -1) return

      let targetIndex = draggedIndex
      for (let i = 0; i < order.length; i++) {
        if (i === draggedIndex) continue
        const el = rowRefs.current.get(getId(order[i]))
        if (!el) continue
        const rect = el.getBoundingClientRect()
        const mid = rect.top + rect.height / 2
        if (currentY > mid) targetIndex = i
      }

      if (targetIndex !== draggedIndex) {
        // Medimos dónde está cada fila (menos la que arrastramos, que ya
        // sigue al dedo por su cuenta) justo antes de cambiar el orden, para
        // poder animar la diferencia después del render.
        prevRectsRef.current = captureRects()
        const next = order.slice()
        const [moved] = next.splice(draggedIndex, 1)
        next.splice(targetIndex, 0, moved)
        baseOrderRef.current = next
        setDragOrder(next)
      }
    },
    [getId, captureRects],
  )

  // FLIP: después de cualquier cambio de orden, las filas que no se están
  // arrastrando se reposicionan de golpe (nuevo layout), y aquí las hacemos
  // arrancar animadas desde su posición anterior hasta la nueva.
  useLayoutEffect(() => {
    if (!dragOrder) return
    const prevRects = prevRectsRef.current
    if (prevRects.size === 0) return
    rowRefs.current.forEach((el, id) => {
      if (id === draggingIdRef.current) return
      const prev = prevRects.get(id)
      if (!prev) return
      const next = el.getBoundingClientRect()
      const deltaY = prev.top - next.top
      if (Math.abs(deltaY) < 0.5) return
      el.style.transition = 'none'
      el.style.transform = `translateY(${deltaY}px)`
      // Fuerza al navegador a aplicar el transform de arriba antes de
      // quitarlo, si no, no hay nada que animar.
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      el.getBoundingClientRect()
      requestAnimationFrame(() => {
        el.style.transition = 'transform 220ms cubic-bezier(0.2, 0, 0.2, 1)'
        el.style.transform = ''
      })
    })
  }, [dragOrder])

  const handlePointerUp = useCallback(() => {
    const draggingId = draggingIdRef.current
    if (!draggingId) return
    const el = rowRefs.current.get(draggingId)
    if (el) {
      el.style.transition = 'transform 180ms cubic-bezier(0.2, 0, 0.2, 1)'
      el.style.transform = ''
      const cleanupEl = el
      window.setTimeout(() => {
        cleanupEl.style.transition = ''
        cleanupEl.style.zIndex = ''
        cleanupEl.style.willChange = ''
      }, 190)
    }
    draggingIdRef.current = null
    setDraggingId(null)
    const finalOrder = baseOrderRef.current
    setDragOrder(null)
    onCommit(finalOrder)
  }, [onCommit])

  return {
    displayItems,
    draggingId,
    registerRow,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
  }
}
