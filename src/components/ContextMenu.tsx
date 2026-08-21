import type { ReactNode } from 'react'
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
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm sm:items-center" onClick={onClose}>
      <div
        className="glass-panel w-full max-w-sm rounded-t-[28px] p-2 shadow-[0_24px_60px_-20px_rgba(20,21,26,0.5)] sm:rounded-[28px]"
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
    </div>
  )
}
