import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { useLanguage } from '../lib/i18n'

const CONTAINER_SIZE = 260
const OUTPUT_SIZE = 480

export default function AvatarCropper({
  file,
  onCancel,
  onConfirm,
}: {
  file: File
  onCancel: () => void
  onConfirm: (blob: Blob) => void
}) {
  const { t } = useLanguage()
  const [imgUrl, setImgUrl] = useState<string | null>(null)
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null)
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null)
  const imgRef = useRef<HTMLImageElement>(null)

  useEffect(() => {
    const url = URL.createObjectURL(file)
    setImgUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  if (!imgUrl) return null

  // Tamaño "base" (sin zoom): cubre el círculo entero manteniendo la
  // proporción original de la foto. A partir de aquí el zoom se aplica
  // SIEMPRE con un único factor de escala (transform: scale), nunca
  // recalculando ancho y alto por separado — así la imagen nunca se puede
  // deformar, solo agrandar de forma uniforme.
  const baseScale = naturalSize ? Math.max(CONTAINER_SIZE / naturalSize.w, CONTAINER_SIZE / naturalSize.h) : 1
  const baseW = naturalSize ? naturalSize.w * baseScale : 0
  const baseH = naturalSize ? naturalSize.h * baseScale : 0
  const displayedW = baseW * scale
  const displayedH = baseH * scale
  const maxOffsetX = Math.max(0, (displayedW - CONTAINER_SIZE) / 2)
  const maxOffsetY = Math.max(0, (displayedH - CONTAINER_SIZE) / 2)

  const clamp = (val: { x: number; y: number }) => ({
    x: Math.min(maxOffsetX, Math.max(-maxOffsetX, val.x)),
    y: Math.min(maxOffsetY, Math.max(-maxOffsetY, val.y)),
  })

  const onPointerDown = (e: ReactPointerEvent) => {
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: offset.x, origY: offset.y }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: ReactPointerEvent) => {
    if (!dragRef.current) return
    const dx = e.clientX - dragRef.current.startX
    const dy = e.clientY - dragRef.current.startY
    setOffset(clamp({ x: dragRef.current.origX + dx, y: dragRef.current.origY + dy }))
  }

  const onPointerUp = () => {
    dragRef.current = null
  }

  const handleImgLoad = () => {
    const el = imgRef.current
    if (!el) return
    setNaturalSize({ w: el.naturalWidth, h: el.naturalHeight })
  }

  const handleConfirm = () => {
    if (!naturalSize) return
    const canvas = document.createElement('canvas')
    canvas.width = OUTPUT_SIZE
    canvas.height = OUTPUT_SIZE
    const ctx = canvas.getContext('2d')
    if (!ctx || !imgRef.current) return

    const ratio = OUTPUT_SIZE / CONTAINER_SIZE
    ctx.beginPath()
    ctx.arc(OUTPUT_SIZE / 2, OUTPUT_SIZE / 2, OUTPUT_SIZE / 2, 0, Math.PI * 2)
    ctx.closePath()
    ctx.clip()

    const drawW = displayedW * ratio
    const drawH = displayedH * ratio
    const drawX = (CONTAINER_SIZE / 2 - displayedW / 2 + offset.x) * ratio
    const drawY = (CONTAINER_SIZE / 2 - displayedH / 2 + offset.y) * ratio

    ctx.drawImage(imgRef.current, drawX, drawY, drawW, drawH)
    canvas.toBlob(
      (blob) => {
        if (blob) onConfirm(blob)
      },
      'image/jpeg',
      0.92,
    )
  }

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-sm rounded-2xl p-6 shadow-xl bg-[var(--color-surface)]">
        <h2 className="mb-1 text-lg font-semibold text-slate-900 dark:text-slate-100">{t('avatar.adjustTitle')}</h2>
        <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">{t('avatar.adjustHint')}</p>

        <div
          className="relative mx-auto touch-none overflow-hidden rounded-full bg-[var(--color-surface-alt)]"
          style={{ width: CONTAINER_SIZE, height: CONTAINER_SIZE, cursor: 'grab' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
        >
          {/* eslint-disable-next-line jsx-a11y/alt-text */}
          <img
            ref={imgRef}
            src={imgUrl}
            onLoad={handleImgLoad}
            draggable={false}
            className="pointer-events-none absolute max-w-none select-none"
            style={{
              width: baseW || undefined,
              height: baseH || undefined,
              left: CONTAINER_SIZE / 2 - baseW / 2 + offset.x,
              top: CONTAINER_SIZE / 2 - baseH / 2 + offset.y,
              transform: `scale(${scale})`,
              transformOrigin: 'center',
            }}
          />
        </div>

        <input
          type="range"
          min={1}
          max={3}
          step={0.01}
          value={scale}
          onChange={(e) => {
            const next = Number(e.target.value)
            setScale(next)
            setOffset((prev) => clamp(prev))
          }}
          aria-label={t('avatar.zoomLabel')}
          className="mt-5 w-full accent-brand-600"
        />

        <div className="mt-5 flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 rounded-lg border px-4 py-2.5 font-medium text-slate-700 hover:bg-slate-50 border-[var(--color-surface-border)] dark:text-slate-200 dark:hover:bg-slate-700"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={handleConfirm}
            className="flex-1 rounded-lg bg-brand-600 px-4 py-2.5 font-medium text-white hover:bg-brand-700"
          >
            {t('avatar.usePhoto')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
