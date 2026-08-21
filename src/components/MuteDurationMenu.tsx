import { useLanguage } from '../lib/i18n'
import ContextMenu from './ContextMenu'
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
        { label: t('mute.for1h'), icon: '🕐', onSelect: () => onPick('1h') },
        { label: t('mute.for8h'), icon: '🕗', onSelect: () => onPick('8h') },
        { label: t('mute.for1w'), icon: '📅', onSelect: () => onPick('1w') },
        { label: t('mute.forAlways'), icon: '🔕', onSelect: () => onPick('always') },
      ]}
    />
  )
}
