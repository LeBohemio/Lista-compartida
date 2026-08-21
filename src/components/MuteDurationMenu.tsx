import { useLanguage } from '../lib/i18n'
import ContextMenu from './ContextMenu'
import { BellOffIcon, CalendarIcon, ClockIcon } from './icons'
import type { MuteDuration } from '../lib/mute'

// Hoja de opciones para elegir CUÁNTO tiempo silenciar (un contacto o el
// chat de una lista) — se abre al pulsar "Silenciar" cuando todavía no
// estaba silenciado. Reutiliza ContextMenu para que se vea y se comporte
// igual que el resto de menús de la app. Ver migration_v27.sql.
export default function MuteDurationMenu({
  onPick,
  onClose,
}: {
  onPick: (duration: MuteDuration) => void
  onClose: () => void
}) {
  const { t } = useLanguage()
  return (
    <ContextMenu
      title={t('mute.chooseDuration')}
      onClose={onClose}
      actions={[
        { label: t('mute.for1h'), icon: <ClockIcon className="h-5 w-5" />, onSelect: () => onPick('1h') },
        { label: t('mute.for8h'), icon: <ClockIcon className="h-5 w-5" />, onSelect: () => onPick('8h') },
        { label: t('mute.for1w'), icon: <CalendarIcon className="h-5 w-5" />, onSelect: () => onPick('1w') },
        { label: t('mute.forAlways'), icon: <BellOffIcon className="h-5 w-5" />, onSelect: () => onPick('always') },
      ]}
    />
  )
}
