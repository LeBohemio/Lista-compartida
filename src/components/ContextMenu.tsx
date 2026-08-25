import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useLanguage } from '../lib/i18n'

export type ContextMenuAction = {
  label: string
  // Acepta tanto un emoji suelto (para lo que aún no se ha migrado) como un
  // icono de línea de icons.tsx (p. ej. <TrashIcon className="h-5 w-5" />).
  icon?: ReactNode
  danger?: boolean
  onSelect: () => void
}

export default function ContextMenu({
  title,
  actions,
  onClose,
}: {
  title?: string
  actions: ContextMenuAction[]
  onClose: () => void
}) {
  const { t } = useLanguage()
  // Portal a document.body: este menú se abre desde dentro de tarjetas con
  // efecto cristal (glass-panel → backdrop-filter), y backdrop-filter en un
  // antepasado "atrapa" a cualquier hijo "fixed" dentro de la caja de ESA
  // tarjeta en vez de la pantalla entera (así lo define CSS: filter y
  // backdrop-filter crean su propio "containing block" para fixed/absolute,
  // igual que transform). Sin el portal, este menú se quedaba flotando
  // donde estaba la tarjeta en vez de anclado de verdad abajo del todo, y no
  // llegaba a tapar la barra de navegación inferior. Con el portal, el menú
  // vive fuera de esa tarjeta en el DOM, así que "fixed inset-0" vuelve a
  // referirse a la pantalla real.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      {/* select-none en todo el menú: se abre justo cuando sueltas una
          pulsación larga sobre un mensaje, y si el dedo todavía estaba algo
          apoyado al aparecer, el navegador podía confundirlo con un
          arrastre de selección de texto sobre la primera opción
          ("Responder") — de ahí que a veces saliera resaltada en azul como
          si se hubiera seleccionado esa palabra. */}
      <div
        className="glass-panel w-full max-w-sm select-none rounded-t-[28px] p-2 shadow-[0_24px_60px_-20px_rgba(20,21,26,0.5)] sm:rounded-[28px]"
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <p className="px-4 pb-1 pt-3 font-mono text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">{title}</p>
        )}
        <div className="divide-y divide-[var(--color-glass-border)]">
          {actions.map((a) => (
            <button
              key={a.label}
              onClick={() => {
                onClose()
                a.onSelect()
              }}
              className={`flex w-full items-center gap-3 px-4 py-3.5 text-left text-sm font-medium ${
                a.danger
                  ? 'text-red-600 hover:bg-red-50/70 dark:text-red-400 dark:hover:bg-red-950/40'
                  : 'text-slate-700 hover:bg-white/60 dark:text-slate-200 dark:hover:bg-white/10'
              }`}
            >
              {a.icon && (
                <span className="flex h-5 w-5 shrink-0 items-center justify-center text-base">{a.icon}</span>
              )}
              {a.label}
            </button>
          ))}
        </div>
        <button
          onClick={onClose}
          className="mt-1 w-full rounded-2xl px-4 py-3 text-center text-sm font-medium text-slate-500 hover:bg-white/60 dark:text-slate-400 dark:hover:bg-white/10"
        >
          {t('menu.cancel')}
        </button>
      </div>
    </div>,
    document.body,
  )
}
