import { useEffect, useState } from 'react'
import { subscribeSwipeDebug } from '../lib/swipeDebug'

// Panel temporal de depuración, visible encima de todo, en cualquier
// pantalla — ver el comentario completo en swipeDebug.ts. Aparece solo
// cuando hay algo que mostrar (nada al abrir la app) y se puede cerrar con
// la "×", por si molesta mientras se usa la app con normalidad.
export default function SwipeDebugOverlay() {
  const [lines, setLines] = useState<string[]>([])
  const [closed, setClosed] = useState(false)

  useEffect(() => subscribeSwipeDebug(setLines), [])

  if (lines.length === 0 || closed) return null

  return (
    <div
      className="fixed inset-x-1 top-1 z-[9999] max-h-48 overflow-y-auto rounded-lg bg-black/85 p-2 pr-6 font-mono text-[10px] leading-tight text-lime-300 shadow-lg"
      style={{ paddingTop: 'calc(0.25rem + env(safe-area-inset-top))' }}
    >
      <button
        onClick={() => setClosed(true)}
        className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-white/10 text-white"
        aria-label="Cerrar registro de depuración"
      >
        ×
      </button>
      {lines.map((line, i) => (
        <div key={i}>{line}</div>
      ))}
    </div>
  )
}
