import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'

type ToastKind = 'error' | 'info'
type ToastState = { id: number; message: string; kind: ToastKind } | null

type ToastContextValue = {
  // Aviso genérico, para casos puntuales que ya tenían su propio mensaje.
  showToast: (message: string) => void
  // Pensado específicamente para errores de guardado (una llamada a
  // Supabase que devuelve error): mismo mecanismo, pero deja claro en el
  // nombre para qué es, para que se use en vez de tragarse el error en
  // silencio. Ver el comentario largo en el propio provider más abajo.
  showError: (message: string) => void
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined)

const DISMISS_AFTER_MS = 4000

// Antes, la app tenía decenas de sitios que hacían "await supabase...()" y,
// si `error` venía relleno, no hacían NADA con él — ni un console.error, ni
// un aviso en pantalla. Para quien usa la app eso se veía como "he tocado
// el botón y no ha pasado nada" o, peor, como que el cambio SÍ se había
// guardado cuando en realidad no. Este provider da un sitio único y
// sencillo (el hook useToast() de abajo) para avisar de un fallo sin tener
// que montar un <Toast/> y su temporizador en cada pantalla por separado
// (antes cada pantalla que quería un aviso tenía que repetir ese código,
// ver por ejemplo el toastMessage de ListsPage.tsx).
//
// Se monta una única vez, arriba del todo (ver App.tsx), así que funciona
// aunque se navegue de una pantalla a otra justo después de disparar el
// aviso.
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const nextId = useRef(0)

  const show = useCallback((message: string, kind: ToastKind) => {
    if (timerRef.current) clearTimeout(timerRef.current)
    const id = ++nextId.current
    setToast({ id, message, kind })
    timerRef.current = setTimeout(() => {
      setToast((current) => (current?.id === id ? null : current))
    }, DISMISS_AFTER_MS)
  }, [])

  const value = useMemo<ToastContextValue>(
    () => ({
      showToast: (message: string) => show(message, 'info'),
      showError: (message: string) => show(message, 'error'),
    }),
    [show],
  )

  return (
    <ToastContext.Provider value={value}>
      {children}
      {toast && (
        <div
          role="alert"
          className={`fixed bottom-24 left-1/2 z-50 max-w-[90vw] -translate-x-1/2 rounded-full px-4 py-2.5 text-center text-sm font-medium text-white shadow-xl ${
            toast.kind === 'error' ? 'bg-red-600' : 'bg-slate-900'
          }`}
        >
          {toast.message}
        </div>
      )}
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast debe usarse dentro de <ToastProvider>')
  return ctx
}
