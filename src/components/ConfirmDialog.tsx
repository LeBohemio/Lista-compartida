import { useLanguage } from '../lib/i18n'

export default function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel,
  danger = false,
  onConfirm,
  onCancel,
}: {
  title?: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const { t } = useLanguage()
  const resolvedTitle = title ?? t('dialogs.defaultTitle')
  const resolvedConfirmLabel = confirmLabel ?? t('dialogs.defaultConfirm')
  const resolvedCancelLabel = cancelLabel ?? t('common.cancel')
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm sm:items-center" onClick={onCancel}>
      <div
        className="glass-panel w-full max-w-sm rounded-t-[28px] p-6 shadow-[0_24px_60px_-20px_rgba(20,21,26,0.5)] sm:rounded-[28px]"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-2 text-lg font-semibold text-slate-900 dark:text-slate-100">{resolvedTitle}</h2>
        <p className="mb-5 text-sm text-slate-600 dark:text-slate-300">{message}</p>
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 rounded-full border px-4 py-2.5 font-medium text-slate-700 hover:bg-white/60 border-[var(--color-glass-border)] dark:text-slate-200 dark:hover:bg-white/10"
          >
            {resolvedCancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className={`flex-1 rounded-full px-4 py-2.5 font-medium text-white shadow-[0_10px_22px_-10px_var(--color-glow)] ${
              danger
                ? 'bg-gradient-to-br from-red-500 to-red-600 shadow-[0_10px_22px_-10px_rgba(220,38,38,0.5)]'
                : 'bg-gradient-to-br from-[var(--color-brand-500)] to-[var(--color-brand-600)]'
            }`}
          >
            {resolvedConfirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
