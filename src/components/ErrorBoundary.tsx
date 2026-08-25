import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = { children: ReactNode }
type State = { hasError: boolean }

const LANGUAGE_STORAGE_KEY = 'listas-en-comun-language'

// Red de seguridad para toda la app: si algo revienta al renderizar en
// cualquier pantalla (un dato inesperado, un fallo de programación...), sin
// esto React se limita a desmontar todo y deja la pantalla en blanco, sin
// ninguna explicación ni forma de recuperarse salvo cerrar y volver a abrir
// la app a ciegas. Con este componente envolviendo toda la app (ver
// main.tsx) se muestra en su lugar un aviso sencillo con un botón para
// recargar.
//
// Los "error boundaries" de React solo cazan errores de RENDERIZADO — no
// los que ocurren dentro de un onClick ni los de código async suelto (esos
// ya se manejan aparte, con sus propios mensajes, en cada sitio que hace
// una llamada a Supabase). Cubre el caso más grave: uno que tira abajo la
// pantalla entera.
//
// Se coloca fuera de LanguageProvider a propósito (ver main.tsx) — si el
// fallo viniera de dentro de ese propio proveedor, useLanguage() no estaría
// disponible aquí. Por eso el texto de abajo lee el idioma guardado
// directamente de localStorage (misma clave que usa i18n.tsx) en vez de
// depender del contexto.
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary] Error de renderizado no controlado:', error, info.componentStack)
  }

  render() {
    if (!this.state.hasError) return this.props.children

    let isSpanish = true
    try {
      isSpanish = typeof window === 'undefined' || window.localStorage.getItem(LANGUAGE_STORAGE_KEY) !== 'en'
    } catch {
      // localStorage puede fallar en algunos navegadores/modos privados —
      // nos quedamos con el español por defecto.
    }

    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[var(--color-surface-alt)] px-6 text-center">
        <p className="text-4xl" aria-hidden="true">
          😵
        </p>
        <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          {isSpanish ? 'Algo ha ido mal' : 'Something went wrong'}
        </h1>
        <p className="max-w-sm text-sm text-slate-500 dark:text-slate-400">
          {isSpanish
            ? 'La app se ha encontrado con un error inesperado. Recarga la página para seguir — tus datos están a salvo, guardados en el servidor.'
            : "The app hit an unexpected error. Reload the page to continue — your data is safe, it's stored on the server."}
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-full bg-brand-600 px-5 py-2.5 font-medium text-white transition hover:bg-brand-700"
        >
          {isSpanish ? 'Recargar' : 'Reload'}
        </button>
      </div>
    )
  }
}
