import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'

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
  // El dedo no se mueve en línea recta al arrastrar — aunque la intención
  // sea subir/bajar la nota, es normal que el punto tocado se desvíe
  // también a los lados. Antes solo seguíamos al dedo en vertical (el
  // transform aplicado a la fila solo tenía translateY): en cuanto el dedo
  // se apartaba un poco hacia un lado, la nota se quedaba "atrás" respecto
  // a dónde estaba tocando realmente el dedo, y eso se sentía como que el
  // arrastre se quedaba pillado o solo funcionaba en vertical — no era un
  // límite del navegador (el asa ya tiene touch-action:none y captura el
  // puntero, así que los eventos siguen llegando aunque el dedo se mueva a
  // cualquier sitio de la pantalla), era que nuestro propio código
  // ignoraba el eje horizontal al dibujar. dragStartXRef/currentOffsetXRef
  // guardan lo mismo que sus equivalentes en Y pero para el eje horizontal,
  // para que la nota seguida al dedo en las dos direcciones a la vez. El
  // reparto de sitio en la lista sigue decidiéndose solo por Y (esto es una
  // lista vertical, la X no cambia el orden), así que esa parte no cambia.
  const dragStartXRef = useRef(0)
  const currentOffsetXRef = useRef(0)
  const draggingIdRef = useRef<string | null>(null)
  // Último desplazamiente (transform) aplicado a la fila arrastrada, y su
  // posición "natural" (de layout, sin ese transform) conocida más
  // reciente — hacen falta para corregir el salto que se veía cuando la
  // propia fila arrastrada cambiaba de sitio en la lista a mitad de gesto
  // (ver el efecto más abajo).
  const currentOffsetRef = useRef(0)
  const dragNaturalTopRef = useRef(0)
  const lastPointerYRef = useRef(0)
  // El dedo real nunca se mueve en línea recta: aunque la intención sea
  // "bajar", el punto tocado tiembla unos pocos píxeles a los lados y hacia
  // arriba/abajo continuamente. Sin nada que lo compense, ese temblor hacía
  // que el índice objetivo oscilara justo alrededor de la frontera entre dos
  // filas muchas veces por segundo, y cada oscilación disparaba
  // captureRects() — una lectura de layout forzada sobre todas las filas —
  // sintiéndose como que el arrastre "se atasca" (ver computeTarget, más
  // abajo, y su margen de histéresis).
  // Las notificaciones de puntero en pantallas táctiles pueden llegar mucho
  // más rápido que los fotogramas que el navegador realmente pinta
  // (especialmente si el dedo tiembla). Procesar cada una en el momento
  // hace un trabajo redundante; en su lugar nos quedamos solo con la
  // posición más reciente y hacemos el trabajo pesado una vez por
  // fotograma como mucho.
  const rafIdRef = useRef<number | null>(null)
  const pendingYRef = useRef<number | null>(null)
  // Auto-scroll: si arrastras cerca del borde de arriba o de abajo de la
  // PANTALLA (no de la tarjeta — el dedo no puede salir de la pantalla, así
  // que ese es el límite real con el que hay que trabajar), la página se
  // desplaza sola en esa dirección mientras sigas ahí, para poder llegar a
  // filas que no estaban a la vista al empezar a arrastrar (el primer o
  // último puesto de una lista larga, por ejemplo). Corre en su propio bucle
  // de fotogramas, independiente del de computeTarget, mientras dure el
  // arrastre. autoScrollTickRef existe para poder arrancar este bucle desde
  // beginDrag (antes en el archivo) sin que beginDrag tenga que depender de
  // la función computeTarget, que se define más abajo.
  const autoScrollFrameRef = useRef<number | null>(null)
  const autoScrollTickRef = useRef<() => void>(() => {})
  const scheduleAutoScrollFrame = useCallback(() => {
    autoScrollFrameRef.current = requestAnimationFrame(() => {
      autoScrollTickRef.current()
    })
  }, [])
  // Justo al soltar, `items` (la lista tal cual llega de fuera) todavía no
  // se ha enterado del nuevo orden — el guardado en el servidor es async, y
  // hasta que no llega la confirmación (o el aviso en tiempo real), sigue
  // reflejando el orden de ANTES de soltar. Si en ese momento dejamos de
  // mostrar el orden que acabamos de calcular, la nota "vuelve" un instante
  // a su sitio viejo y da la sensación de que no se ha colocado — aunque por
  // detrás sí se haya guardado bien. Aquí guardamos solo los IDS en el orden
  // que acabamos de confirmar, y mientras ese mismo conjunto de elementos
  // siga existiendo (nadie ha añadido/borrado nada mientras tanto),
  // reordenamos los datos frescos de `items` según esos IDs — así se ve al
  // momento y además se mantiene al día con cualquier otro cambio (marcar
  // como hecha, editar el texto...) que llegue de fuera mientras tanto.
  const optimisticOrderIdsRef = useRef<string[] | null>(null)

  const registerRow = useCallback((id: string, el: HTMLElement | null) => {
    if (el) rowRefs.current.set(id, el)
    else rowRefs.current.delete(id)
  }, [])

  const displayItems = useMemo(() => {
    if (dragOrder) return dragOrder
    const optimisticIds = optimisticOrderIdsRef.current
    if (!optimisticIds || optimisticIds.length !== items.length) return items
    const byId = new Map(items.map((it) => [getId(it), it]))
    const reordered: T[] = []
    for (const id of optimisticIds) {
      const it = byId.get(id)
      // Si algún id ya no existe en los datos frescos (se borró, o el
      // conjunto ha cambiado de cualquier otra forma), el orden optimista ya
      // no vale — mejor fiarse del que trae el servidor.
      if (!it) return items
      reordered.push(it)
    }
    return reordered
  }, [dragOrder, items, getId])

  const captureRects = useCallback(() => {
    const map = new Map<string, DOMRect>()
    rowRefs.current.forEach((el, id) => map.set(id, el.getBoundingClientRect()))
    return map
  }, [])

  const beginDrag = useCallback(
    (id: string, startY: number, startX: number, target: HTMLElement, pointerId: number) => {
      baseOrderRef.current = displayItems
      setDragOrder(displayItems)
      setDraggingId(id)
      draggingIdRef.current = id
      dragStartYRef.current = startY
      dragStartXRef.current = startX
      currentOffsetXRef.current = 0
      lastPointerYRef.current = startY
      currentOffsetRef.current = 0
      const startRects = captureRects()
      prevRectsRef.current = startRects
      settledRectsRef.current = startRects
      dragNaturalTopRef.current = startRects.get(id)?.top ?? 0
      if (rafIdRef.current != null) {
        cancelAnimationFrame(rafIdRef.current)
        rafIdRef.current = null
      }
      pendingYRef.current = null
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
      if (autoScrollFrameRef.current != null) cancelAnimationFrame(autoScrollFrameRef.current)
      scheduleAutoScrollFrame()
    },
    [displayItems, captureRects, scheduleAutoScrollFrame],
  )

  // El asa (el icono ⠿) ya lleva touch-action: none puesto de forma
  // estática en su className en cuanto la fila entra en modo reordenar —no
  // aquí, de forma reactiva— porque para que el navegador respete ese valor
  // en el primer toque, tiene que estar ya así desde antes de que empiece el
  // gesto, no aplicarse a mitad. Aquí solo hace falta arrancar el arrastre.
  const handlePointerDown = useCallback(
    (id: string) => (e: ReactPointerEvent) => {
      if (navigator.vibrate) navigator.vibrate(15)
      beginDrag(id, e.clientY, e.clientX, e.currentTarget as HTMLElement, e.pointerId)
    },
    [beginDrag],
  )

  // Un margen (en píxeles) que hay que cruzar CLARAMENTE, más allá de la
  // frontera entre dos filas, antes de aceptar que el sitio de destino ha
  // cambiado. Sin esto, un dedo real (que nunca se mueve en línea recta
  // perfecta) hace que el punto tocado tiemble justo alrededor de esa
  // frontera, y cada temblor contaba como "cambio de sitio" — disparando en
  // bucle el recálculo pesado (captureRects) que viene después. Con el
  // margen, hace falta pasarse claramente para que cuente, así que un
  // simple temblor ya no dispara nada.
  const SWAP_MARGIN_PX = 10

  const computeTarget = useCallback(
    (currentY: number) => {
      const draggingId = draggingIdRef.current
      if (!draggingId) return

      // Avanza como mucho una fila cada vez que hace falta, comparando
      // siempre solo contra la fila justo por encima y la fila justo por
      // debajo del sitio estable actual — nunca "salta" directamente a un
      // índice lejano. Esto es justo lo que faltaba antes: comparar contra
      // TODAS las filas de golpe con un margen podía, si el dedo temblaba
      // justo tras cruzar una frontera, hacer que el sitio calculado
      // retrocediera de un salto varias filas en vez de solo una — eso era
      // lo que se sentía como que el arrastre "se atascaba". El bucle de
      // abajo, en cambio, solo permite retroceder o avanzar de vecino en
      // vecino, así que como mucho se equivoca en una fila, nunca varias.
      // (Si el dedo se mueve muy rápido en un único fotograma, el bucle
      // simplemente da varios pasos seguidos, uno por fila cruzada.)
      let guard = 0
      while (guard++ < 200) {
        const order = baseOrderRef.current
        const draggedIndex = order.findIndex((it) => getId(it) === draggingId)
        if (draggedIndex === -1) return

        let swapWith = -1
        const belowIndex = draggedIndex + 1
        if (belowIndex < order.length) {
          const rect = settledRectsRef.current.get(getId(order[belowIndex]))
          if (rect) {
            const mid = rect.top + rect.height / 2
            // Hace falta pasarse claramente del punto medio de la fila de
            // abajo (no solo rozarlo) para aceptar que toca bajar un
            // puesto — así un temblor pequeño cerca de la frontera no
            // cuenta.
            if (currentY > mid + SWAP_MARGIN_PX) swapWith = belowIndex
          }
        }
        if (swapWith === -1) {
          const aboveIndex = draggedIndex - 1
          if (aboveIndex >= 0) {
            const rect = settledRectsRef.current.get(getId(order[aboveIndex]))
            if (rect) {
              const mid = rect.top + rect.height / 2
              if (currentY < mid - SWAP_MARGIN_PX) swapWith = aboveIndex
            }
          }
        }

        if (swapWith === -1) break

        // Medimos dónde está cada fila (menos la que arrastramos, que ya
        // sigue al dedo por su cuenta) justo antes de cambiar el orden,
        // para poder animar la diferencia después del render.
        prevRectsRef.current = captureRects()
        const next = order.slice()
        const [moved] = next.splice(draggedIndex, 1)
        next.splice(swapWith, 0, moved)
        baseOrderRef.current = next
        setDragOrder(next)
      }
    },
    [getId, captureRects],
  )

  // Franja (en píxeles, medida desde el borde de la pantalla, no de la
  // tarjeta) dentro de la cual se activa el auto-scroll, y velocidad máxima
  // a la que se desplaza cuando el dedo está pegado del todo al borde
  // (cuanto más cerca del borde, más rápido — no es una velocidad fija).
  const AUTO_SCROLL_EDGE_PX = 70
  const AUTO_SCROLL_MAX_SPEED_PX = 16

  const autoScrollTick = useCallback(() => {
    if (!draggingIdRef.current) return
    const y = lastPointerYRef.current
    const viewportHeight = window.innerHeight
    let delta = 0
    if (y < AUTO_SCROLL_EDGE_PX) {
      const depth = AUTO_SCROLL_EDGE_PX - Math.max(y, 0)
      delta = -Math.ceil((depth / AUTO_SCROLL_EDGE_PX) * AUTO_SCROLL_MAX_SPEED_PX)
    } else if (y > viewportHeight - AUTO_SCROLL_EDGE_PX) {
      const depth = y - (viewportHeight - AUTO_SCROLL_EDGE_PX)
      delta = Math.ceil((depth / AUTO_SCROLL_EDGE_PX) * AUTO_SCROLL_MAX_SPEED_PX)
    }
    if (delta !== 0) {
      const before = window.scrollY
      window.scrollBy(0, delta)
      // Si de verdad se ha movido la página (puede que ya estuviéramos en el
      // principio o el final del todo, y entonces no hay nada que hacer),
      // las posiciones "de reposo" que teníamos guardadas de las demás filas
      // ya no valen — todas se han desplazado en pantalla el mismo tanto que
      // la página. Las volvemos a medir y aprovechamos para comprobar otra
      // vez si toca cambiar de sitio, para que el reordenar siga avanzando
      // fila a fila mientras dura el scroll automático, no solo cuando el
      // dedo se mueve de verdad.
      if (window.scrollY !== before) {
        settledRectsRef.current = captureRects()
        computeTarget(y)
      }
    }
    scheduleAutoScrollFrame()
  }, [captureRects, computeTarget, scheduleAutoScrollFrame])
  autoScrollTickRef.current = autoScrollTick

  const flushPointerMove = useCallback(() => {
    rafIdRef.current = null
    const currentY = pendingYRef.current
    if (currentY == null) return
    computeTarget(currentY)
  }, [computeTarget])

  const handlePointerMove = useCallback(
    (e: ReactPointerEvent) => {
      const draggingId = draggingIdRef.current
      if (!draggingId) return
      e.preventDefault()
      const currentY = e.clientY
      lastPointerYRef.current = currentY
      pendingYRef.current = currentY

      // La fila que se arrastra sigue al dedo directamente, sin esperar a
      // ningún render — se siente inmediato. Esta parte es barata (solo
      // pone un transform en un nodo ya existente) así que se hace en cada
      // evento, no solo una vez por fotograma.
      const currentX = e.clientX
      const draggedEl = rowRefs.current.get(draggingId)
      if (draggedEl) {
        const offset = currentY - dragStartYRef.current
        const offsetX = currentX - dragStartXRef.current
        currentOffsetRef.current = offset
        currentOffsetXRef.current = offsetX
        draggedEl.style.transform = `translateY(${offset}px) translateX(${offsetX}px) scale(1.02)`
      }

      // Lo caro (decidir si toca cambiar de sitio, y si toca, medir el
      // layout de todas las filas) se limita a como mucho una vez por
      // fotograma pintado. En una pantalla táctil pueden llegar bastantes
      // más eventos "pointermove" que fotogramas — sobre todo si el dedo
      // tiembla — y procesarlos todos era justo lo que hacía que se sintiera
      // a tirones.
      if (rafIdRef.current == null) {
        rafIdRef.current = requestAnimationFrame(flushPointerMove)
      }
    },
    [flushPointerMove],
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
          draggedEl.style.transform = `translateY(${offset}px) translateX(${currentOffsetXRef.current}px) scale(1.02)`
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
    if (autoScrollFrameRef.current != null) {
      cancelAnimationFrame(autoScrollFrameRef.current)
      autoScrollFrameRef.current = null
    }
    if (rafIdRef.current != null) {
      cancelAnimationFrame(rafIdRef.current)
      rafIdRef.current = null
      // Puede quedar un último movimiento sin procesar (llegó un
      // pointermove justo antes de soltar, todavía no le había tocado su
      // fotograma) — lo aplicamos ya mismo para que el orden final
      // coincida exactamente con el último sitio donde estaba el dedo.
      if (pendingYRef.current != null) computeTarget(pendingYRef.current)
    }
    pendingYRef.current = null
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
    // Guardamos ya el orden que acabamos de soltar como "optimista" (ver el
    // comentario junto a optimisticOrderIdsRef) para que displayItems lo
    // siga mostrando sin parpadeo mientras el guardado en el servidor
    // termina de confirmarse por detrás.
    optimisticOrderIdsRef.current = finalOrder.map(getId)
    setDragOrder(null)
    onCommit(finalOrder)
  }, [onCommit, computeTarget, getId])

  // Por si el componente desaparece de golpe a mitad de un arrastre (por
  // ejemplo, si sales de la lista sin soltar el dedo primero): sin esto, los
  // dos bucles de fotogramas (el del auto-scroll y el del reordenar)
  // seguirían corriendo de fondo para siempre.
  useEffect(() => {
    return () => {
      if (autoScrollFrameRef.current != null) cancelAnimationFrame(autoScrollFrameRef.current)
      if (rafIdRef.current != null) cancelAnimationFrame(rafIdRef.current)
    }
  }, [])

  return {
    displayItems,
    draggingId,
    registerRow,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
  }
}
