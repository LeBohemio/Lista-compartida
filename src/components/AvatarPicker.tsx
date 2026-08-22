import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useLanguage, type TranslationKey } from '../lib/i18n'
import { CloseIcon } from './icons'

const AVATAR_CATEGORIES: { slug: string; labelKey: TranslationKey }[] = [
  { slug: 'realista', labelKey: 'avatarPicker.realista' },
  { slug: 'ilustracion', labelKey: 'avatarPicker.ilustracion' },
  { slug: 'anime', labelKey: 'avatarPicker.anime' },
  { slug: 'ciberpunk', labelKey: 'avatarPicker.ciberpunk' },
  { slug: 'animales', labelKey: 'avatarPicker.animales' },
  { slug: 'animales-divertidos', labelKey: 'avatarPicker.animalesDivertidos' },
  { slug: 'monos-divertidos', labelKey: 'avatarPicker.monosDivertidos' },
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

  const activeIndex = AVATAR_CATEGORIES.findIndex((c) => c.slug === activeSlug)
  const goToCategory = (index: number) => {
    const clamped = Math.max(0, Math.min(AVATAR_CATEGORIES.length - 1, index))
    setActiveSlug(AVATAR_CATEGORIES[clamped].slug)
  }

  // Deslizar hacia los lados directamente sobre las fotos también cambia de
  // categoría (además de tocar las pompitas de arriba) — como un carrusel.
  // touch-action: pan-y (clase estática touch-pan-y más abajo, no puesta a
  // mano por JS) le dice al navegador desde el primer instante del toque
  // "el gesto vertical es scroll normal tuyo, el horizontal lo llevo yo",
  // así puede seguir haciendo scroll vertical con normalidad si hay más de
  // una fila de fotos, sin que compita con el deslizar horizontal.
  const swipeStartRef = useRef<{ x: number; y: number } | null>(null)
  const SWIPE_THRESHOLD_PX = 40

  const handleGridPointerDown = (e: ReactPointerEvent) => {
    swipeStartRef.current = { x: e.clientX, y: e.clientY }
  }
  const handleGridPointerUp = (e: ReactPointerEvent) => {
    const start = swipeStartRef.current
    swipeStartRef.current = null
    if (!start) return
    const deltaX = e.clientX - start.x
    const deltaY = e.clientY - start.y
    // Solo cuenta como deslizar de categoría si el movimiento es
    // claramente más horizontal que vertical — si no, es que estabas
    // haciendo scroll normal por la rejilla, o solo has tocado una foto.
    if (Math.abs(deltaX) < SWIPE_THRESHOLD_PX || Math.abs(deltaX) < Math.abs(deltaY)) return
    goToCategory(deltaX < 0 ? activeIndex + 1 : activeIndex - 1)
  }

  // Cuando la categoría activa cambia por deslizar (no solo al tocar su
  // pompita, que ya está siempre visible porque la acabas de tocar), la
  // llevamos a la vista dentro de la fila de categorías, por si estaba
  // fuera de pantalla.
  const pillRefs = useRef<Map<string, HTMLButtonElement>>(new Map())
  useEffect(() => {
    pillRefs.current.get(activeSlug)?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
  }, [activeSlug])

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div
        className="glass-panel flex max-h-[88vh] w-full max-w-md flex-col overflow-hidden rounded-t-[28px] shadow-[0_24px_60px_-20px_rgba(20,21,26,0.5)] sm:rounded-[28px]"
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
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>

        {/* Previsualización grande de la que tengas seleccionada ahora
            mismo — se actualiza al momento al tocar cualquier avatar de la
            rejilla de abajo, para que se vea bien antes de confirmar. */}
        <div className="mt-4 flex justify-center">
          {selected ? (
            <img
              src={selected}
              alt=""
              className="h-24 w-24 rounded-full object-cover ring-4 ring-brand-100 dark:ring-brand-950/50"
            />
          ) : (
            <div className="flex h-24 w-24 items-center justify-center rounded-full border-2 border-dashed text-xs text-slate-400 border-[var(--color-glass-border)]">
              {t('avatarPicker.noneSelected')}
            </div>
          )}
        </div>

        <div className="mt-4 flex gap-1.5 overflow-x-auto px-6 pb-1">
          {AVATAR_CATEGORIES.map((cat) => (
            <button
              key={cat.slug}
              ref={(el) => {
                if (el) pillRefs.current.set(cat.slug, el)
                else pillRefs.current.delete(cat.slug)
              }}
              onClick={() => setActiveSlug(cat.slug)}
              className={`shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium transition ${
                activeSlug === cat.slug
                  ? 'bg-gradient-to-br from-[var(--color-brand-500)] to-[var(--color-brand-600)] text-white shadow-[0_8px_18px_-8px_var(--color-glow)]'
                  : 'border text-slate-600 hover:bg-white/40 border-[var(--color-glass-border)] dark:text-slate-300 dark:hover:bg-white/5'
              }`}
            >
              {t(cat.labelKey)}
            </button>
          ))}
        </div>

        <div
          className="flex-1 touch-pan-y overflow-y-auto px-6 py-4"
          onPointerDown={handleGridPointerDown}
          onPointerUp={handleGridPointerUp}
        >
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

        <div className="flex gap-3 border-t px-6 py-4 border-[var(--color-glass-border)]">
          <button
            onClick={onClose}
            className="flex-1 rounded-full border px-4 py-2.5 font-medium text-slate-700 hover:bg-white/60 border-[var(--color-glass-border)] dark:text-slate-200 dark:hover:bg-white/10"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={confirm}
            disabled={!selected}
            className="flex-1 rounded-full bg-gradient-to-br from-[var(--color-brand-500)] to-[var(--color-brand-600)] px-4 py-2.5 font-medium text-white shadow-[0_10px_22px_-10px_var(--color-glow)] disabled:opacity-50"
          >
            {t('avatarPicker.use')}
          </button>
        </div>
      </div>
    </div>
  )
}
