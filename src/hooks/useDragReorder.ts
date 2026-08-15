import { useCallback, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'

/**
 * Reordenar una lista arrastrando desde un asa dedicada (el icono ⠿ que se
 * ve en cada fila en modo reordenar) — no vale con tocar en cualquier punto
 * de la fila.
 *
 * Por qué un asa y no "mantener pulsada la fila entera" (como se hacía
 * antes): en la web, el navegador decide si un toque va a hacer scroll o no
 * en el mismísimo instante en que tocas la pantalla, y ya no puede cambiar
 * de opinión a mitad de gesto. Si dejamos que se pueda arrastrar tocando en
 * cualquier sitio, no hay forma fiable de "esperar a ver si mantienes
 * pulsado" sin bloquear también el scroll normal mientras tanto (o, si no
 * lo bloqueamos a tiempo, el fondo se desliza solo al arrastrar — el bug que
 * arreglamos antes). Con un asa concreta no hay ambigüedad: tocar el asa
 * solo puede significar "quiero arrastrar", así que el arrastre puede
 * empezar al instante (sin esperar ninguna pulsación larga) y el resto de la
 * fila queda completamente libre para hacer scroll, como si no estuvieras en
 * modo reordenar.
 *
 * Cosas para que se sienta bien al tacto:
 *  1) La fila que arrastras sigue al dedo en tiempo real (transform directo
 *     sobre su nodo del DOM, sin pasar por el estado de React en cada
 *     movimiento, para que no haya tirones). Cuando esa fila cambia de
 *     posición dentro de la lista (porque ha hecho sitio para otra), se
 *     corrige el punto de referencia para que no dé un salto.
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
  // Posiciones "reales" (de reposo) de cada fila, para decidir a qué sitio
  // se mueve la que arrastras. Solo se actualizan justo después de un
  // cambio de orden real (antes de animar) — nunca se leen en caliente
  // durante la animación FLIP, porque mientras una fila todavía se está
  // desplazando hacia su sitio, su posición pintada en pantalla no es la
  // definitiva, y comparar contra eso hacía que la fila arrastrada
  // "vibrara" (el objetivo cambiaba de un fotograma a otro sin que te
  // hubieras movido).
  const settledRectsRef = useRef<Map<string, DOMRect>>(new Map())
  const dragStartYRef = useRef(0)
  const draggingIdRef = useRef<string | null>(null)
  // Último desplazamiente (transform) aplicado a la fila arrastrada, y su
  // posición "natural" (de layout, sin ese transform) conocida más
  // reciente — hacen falta para corregir el salto que se veía cuando la
  // propia fila arrastrada cambiaba de sitio en la lista a mitad de gesto
  // (ver el efecto más abajo).
  const currentOffsetRef = useRef(0)
  const dragNaturalTopRef = useRef(0)
  const lastPointerYRef = useRef(0)

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

  const beginDrag = useCallback(
    (id: string, startY: number, target: HTMLElement, pointerId: number) => {
      baseOrderRef.current = items
      setDragOrder(items)
      setDraggingId(id)
      draggingIdRef.current = id
      dragStartYRef.current = startY
      lastPointerYRef.current = startY
      currentOffsetRef.current = 0
      const startRects = captureRects()
      prevRectsRef.current = startRects
      settledRectsRef.current = startRects
      dragNaturalTopRef.current = startRects.get(id)?.top ?? 0
      try {
        target.setPointerCapture(pointerId)
      } catch {
        // el puntero puede haber dejado de existir; no pasa nada.
      }
      const el = rowRefs.current.get(id)
      if (el) {
        el.style.transition = 'none'
        el.style.zIndex = '30'
        el.style.willChange = 'transform'
      }
    },
    [items, captureRects],
  )

  // El asa (el icono ⠿) ya lleva touch-action: none puesto de forma
  // estática en su className en cuanto la fila entra en modo reordenar —no
  // aquí, de forma reactiva— porque para que el navegador respete ese valor
  // en el primer toque, tiene que estar ya así desde antes de que empiece el
  // gesto, no aplicarse a mitad. Aquí solo hace falta arrancar el arrastre.
  const handlePointerDown = useCallback(
    (id: string) => (e: ReactPointerEvent) => {
      if (navigator.vibrate) navigator.vibrate(15)
      beginDrag(id, e.clientY, e.currentTarget as HTMLElement, e.pointerId)
    },
    [beginDrag],
  )

  const handlePointerMove = useCallback(
    (e: ReactPointerEvent) => {
      const draggingId = draggingIdRef.current
      if (!draggingId) return
      e.preventDefault()
      const currentY = e.clientY
      lastPointerYRef.current = currentY

      // La fila que se arrastra sigue al dedo directamente, sin esperar a
      // ningún render — se siente inmediato.
      const draggedEl = rowRefs.current.get(draggingId)
      if (draggedEl) {
        const offset = currentY - dragStartYRef.current
        currentOffsetRef.current = offset
        draggedEl.style.transform = `translateY(${offset}px) scale(1.02)`
      }

      const order = baseOrderRef.current
      const draggedIndex = order.findIndex((it) => getId(it) === draggingId)
      if (draggedIndex === -1) return

      let targetIndex = draggedIndex
      for (let i = 0; i < order.length; i++) {
        if (i === draggedIndex) continue
        // Posición de reposo, no la posición pintada ahora mismo (que
        // puede estar a mitad de la animación FLIP).
        const rect = settledRectsRef.current.get(getId(order[i]))
        if (!rect) continue
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

    // La propia fila arrastrada puede haber cambiado de posición "natural"
    // (de layout) al hacerle sitio a otra — su nodo sigue siendo el mismo,
    // pero ahora vive en otro punto de la lista. Si no lo compensamos, el
    // transform que le aplicamos (pensado como un desplazamiento desde su
    // posición de inicio) deja de coincidir con dónde está el dedo, y la
    // fila da un salto — eso es lo que se sentía como "vibrar". Aquí
    // medimos ese cambio y lo absorbemos en el punto de referencia, para
    // que el dedo y la nota sigan coincidiendo sin ningún salto.
    const draggedId = draggingIdRef.current
    if (draggedId) {
      const draggedEl = rowRefs.current.get(draggedId)
      if (draggedEl) {
        const visualTop = draggedEl.getBoundingClientRect().top
        const naturalTopNow = visualTop - currentOffsetRef.current
        const deltaSwap = naturalTopNow - dragNaturalTopRef.current
        if (Math.abs(deltaSwap) > 0.5) {
          dragStartYRef.current += deltaSwap
          dragNaturalTopRef.current = naturalTopNow
          const offset = lastPointerYRef.current - dragStartYRef.current
          currentOffsetRef.current = offset
          draggedEl.style.transform = `translateY(${offset}px) scale(1.02)`
        }
      }
    }

    rowRefs.current.forEach((el, id) => {
      if (id === draggingIdRef.current) return
      const next = el.getBoundingClientRect()
      // Esta SÍ es la posición de reposo (recién calculada por el layout,
      // todavía sin el transform de la animación aplicado) — la guardamos
      // para que el próximo movimiento del puntero compare contra el sitio
      // real, no contra un fotograma a medio animar.
      settledRectsRef.current.set(id, next)
      const prev = prevRects.get(id)
      if (!prev) return
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
