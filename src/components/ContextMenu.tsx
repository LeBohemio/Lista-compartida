import { useLanguage } from '../lib/i18n'

export type ContextMenuAction = {
  label: string
  icon?: string
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
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-t-2xl bg-white p-2 shadow-xl sm:rounded-2xl dark:bg-slate-800"
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <p className="px-4 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</p>
        )}
        <div className="divide-y divide-slate-100 dark:divide-slate-700">
          {actions.map((a) => (
            <button
              key={a.label}
              onClick={() => {
                onClose()
                a.onSelect()
              }}
              className={`flex w-full items-center gap-3 px-4 py-3.5 text-left text-sm font-medium ${
                a.danger
                  ? 'text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40'
                  : 'text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              {a.icon && <span className="text-base">{a.icon}</span>}
              {a.label}
            </button>
          ))}
        </div>
        <button
          onClick={onClose}
          className="mt-1 w-full rounded-xl px-4 py-3 text-center text-sm font-medium text-slate-500 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-700"
        >
          {t('menu.cancel')}
        </button>
      </div>
    </div>
  )
}
