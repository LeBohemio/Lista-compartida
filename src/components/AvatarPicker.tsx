import { useState } from 'react'
import { useLanguage, type TranslationKey } from '../lib/i18n'

const AVATAR_CATEGORIES: { slug: string; labelKey: TranslationKey }[] = [
  { slug: 'anime', labelKey: 'avatarPicker.anime' },
  { slug: 'caricatura', labelKey: 'avatarPicker.caricatura' },
  { slug: 'minimalista', labelKey: 'avatarPicker.minimalista' },
  { slug: 'ilustracion', labelKey: 'avatarPicker.ilustracion' },
  { slug: 'realista', labelKey: 'avatarPicker.realista' },
  { slug: 'animales', labelKey: 'avatarPicker.animales' },
  { slug: 'pixel-art', labelKey: 'avatarPicker.pixelArt' },
  { slug: 'pixel-art-animales', labelKey: 'avatarPicker.pixelArtAnimales' },
]

const AVATARS_PER_CATEGORY = 10

export default function AvatarPicker({
  currentUrl,
  onClose,
  onSelect,
}: {
  currentUrl: string | null
  onClose: () => void
  onSelect: (url: string) => void
}) {
  const { t } = useLanguage()
  const [activeSlug, setActiveSlug] = useState(AVATAR_CATEGORIES[0].slug)
  const [selected, setSelected] = useState<string | null>(
    currentUrl && currentUrl.startsWith('/avatars/') ? currentUrl : null,
  )

  const confirm = () => {
    if (!selected) return
    onSelect(selected)
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div
        className="flex max-h-[88vh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl shadow-xl sm:rounded-2xl bg-[var(--color-surface)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 pt-6">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{t('avatarPicker.title')}</h2>
          <button
            onClick={onClose}
            aria-label={t('common.close')}
            title={t('common.close')}
            className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-200"
          >
            ✕
          </button>
        </div>

        <div className="mt-4 flex gap-1.5 overflow-x-auto px-6 pb-1">
          {AVATAR_CATEGORIES.map((cat) => (
            <button
              key={cat.slug}
              onClick={() => setActiveSlug(cat.slug)}
              className={`shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 text-sm font-medium transition ${
                activeSlug === cat.slug
                  ? 'border-brand-600 bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-400'
                  : 'text-slate-600 hover:border-brand-300 border-[var(--color-surface-border)] dark:text-slate-300'
              }`}
            >
              {t(cat.labelKey)}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          <div className="grid grid-cols-5 gap-3">
            {Array.from({ length: AVATARS_PER_CATEGORY }, (_, i) => {
              const url = `/avatars/${activeSlug}-${i + 1}.png`
              const isSelected = selected === url
              return (
                <button
                  key={url}
                  onClick={() => setSelected(url)}
                  aria-label={`${t(AVATAR_CATEGORIES.find((c) => c.slug === activeSlug)!.labelKey)} ${i + 1}`}
                  className="relative aspect-square overflow-hidden rounded-full ring-offset-2 transition"
                  style={{ boxShadow: isSelected ? '0 0 0 3px var(--color-brand-600, #4f46e5)' : 'none' }}
                >
                  <img src={url} alt="" className="h-full w-full object-cover" loading="lazy" />
                </button>
              )
            })}
          </div>
        </div>

        <div className="flex gap-3 border-t px-6 py-4 border-[var(--color-surface-border)]">
          <button
            onClick={onClose}
            className="flex-1 rounded-lg border px-4 py-2.5 font-medium text-slate-700 hover:bg-slate-50 border-[var(--color-surface-border)] dark:text-slate-200 dark:hover:bg-slate-700"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={confirm}
            disabled={!selected}
            className="flex-1 rounded-lg bg-brand-600 px-4 py-2.5 font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {t('avatarPicker.use')}
          </button>
        </div>
      </div>
    </div>
  )
}
