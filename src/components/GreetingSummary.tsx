import { useLanguage } from '../lib/i18n'
import { colorForList } from '../lib/colors'
import type { ItemStats } from '../hooks/useLists'
import type { ListWithMembership } from '../lib/types'

// Hoja compacta que se abre al tocar el saludo ("Buenas tardes, ...") en la
// pantalla principal: un vistazo rápido a las listas activas y sus
// pendientes, sin tener que bajar por la pantalla para verlas todas. Al
// tocar una lista, te lleva directamente a ella.
export default function GreetingSummary({
  lists,
  itemStats,
  onClose,
  onSelectList,
}: {
  lists: ListWithMembership[]
  itemStats: Record<string, ItemStats>
  onClose: () => void
  onSelectList: (listId: string) => void
}) {
  const { t } = useLanguage()

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div
        className="flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl shadow-xl sm:rounded-2xl bg-[var(--color-surface)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 pb-4 pt-6">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{t('home.summaryTitle')}</h2>
          <button
            onClick={onClose}
            aria-label={t('common.close')}
            title={t('common.close')}
            className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-200"
          >
            ✕
          </button>
        </div>

        {lists.length === 0 ? (
          <p className="px-6 pb-6 text-sm text-slate-400">{t('lists.empty')}</p>
        ) : (
          <div className="flex-1 overflow-y-auto px-2 pb-3">
            {lists.map((l) => {
              const stats = itemStats[l.id]
              const pending = stats ? stats.total - stats.done : 0
              return (
                <button
                  key={l.id}
                  onClick={() => onSelectList(l.id)}
                  className="flex w-full items-center justify-between gap-3 rounded-lg px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-700"
                >
                  <span className="flex min-w-0 items-center gap-2.5">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: colorForList(l) }}
                      aria-hidden="true"
                    />
                    <span className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{l.name}</span>
                  </span>
                  <span
                    className={`shrink-0 text-xs font-medium ${
                      pending > 0 ? 'text-slate-500 dark:text-slate-400' : 'text-green-600 dark:text-green-400'
                    }`}
                  >
                    {pending > 0 ? `${pending} ${t('home.pendingNotes')}` : t('home.allDone')}
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
