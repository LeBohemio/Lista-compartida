import { useCallback, useRef } from 'react'
import type { MouseEvent as ReactMouseEvent, TouchEvent as ReactTouchEvent } from 'react'

/**
 * Detecta una pulsación larga (mantener pulsado) sobre un elemento, tanto en
 * móvil (touch) como en escritorio (mouse), y evita que el "click" normal se
 * dispare justo después de soltar tras una pulsación larga.
 */
export function useLongPress(onLongPress: () => void, delay = 480) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const triggeredRef = useRef(false)

  const start = useCallback(() => {
    triggeredRef.current = false
    timerRef.current = setTimeout(() => {
      triggeredRef.current = true
      if (navigator.vibrate) navigator.vibrate(15)
      onLongPress()
    }, delay)
  }, [onLongPress, delay])

  const clear = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const onClickCapture = useCallback((e: ReactMouseEvent) => {
    if (triggeredRef.current) {
      e.preventDefault()
      e.stopPropagation()
      triggeredRef.current = false
    }
  }, [])

  return {
    onMouseDown: start,
    onMouseUp: clear,
    onMouseLeave: clear,
    onTouchStart: start,
    onTouchEnd: clear,
    onTouchMove: (_e: ReactTouchEvent) => clear(),
    onClickCapture,
  }
}
