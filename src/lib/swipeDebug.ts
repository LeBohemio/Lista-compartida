// Registro temporal para diagnosticar el fallo del deslizar entre
// pantallas (se queda "colgado" hasta dar un toque de más). Varios
// intentos de arreglarlo a ciegas no han funcionado, así que en vez de
// seguir adivinando, esto apunta en pantalla, en tiempo real, cada evento
// de puntero y cada toque en un botón — así se puede ver EXACTAMENTE qué
// pasa en el móvil de verdad en el momento en que falla, con una simple
// captura de pantalla.
//
// Se quitará (este archivo, SwipeDebugOverlay.tsx y las llamadas a
// swipeDebugLog) en cuanto encontremos la causa real.
type Listener = (lines: string[]) => void

let lines: string[] = []
let listeners: Listener[] = []
let lastTs = 0

export function swipeDebugLog(msg: string) {
  const now = Date.now()
  const delta = lastTs ? now - lastTs : 0
  lastTs = now
  const line = `+${delta}ms ${msg}`
  lines = [...lines.slice(-29), line]
  listeners.forEach((listener) => listener(lines))
}

export function subscribeSwipeDebug(listener: Listener): () => void {
  listeners.push(listener)
  listener(lines)
  return () => {
    listeners = listeners.filter((l) => l !== listener)
  }
}
