import { useState } from 'react'
import { createPortal } from 'react-dom'
import { colorForName } from '../lib/colors'
import { useLanguage } from '../lib/i18n'
import { CloseIcon } from './icons'

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

export default function Avatar({
  username,
  avatarUrl,
  size = 32,
  className = '',
  enlargeOnClick = true,
}: {
  username: string
  avatarUrl?: string | null
  size?: number
  className?: string
  /** Al pulsar la foto se abre una vista ampliada a pantalla completa. Desactívalo
   *  cuando el avatar ya viva dentro de otro elemento clicable (un botón que abre
   *  el perfil, una fila que abre una lista, etc.) para no pisar esa acción. */
  enlargeOnClick?: boolean
}) {
  const { t } = useLanguage()
  const [showFull, setShowFull] = useState(false)

  if (avatarUrl) {
    return (
      <>
        <img
          src={avatarUrl}
          alt={username}
          width={size}
          height={size}
          className={`shrink-0 rounded-full object-cover ${enlargeOnClick ? 'cursor-pointer' : ''} ${className}`}
          style={{ width: size, height: size }}
          onClick={
            enlargeOnClick
              ? (e) => {
                  e.stopPropagation()
                  setShowFull(true)
                }
              : undefined
          }
        />
        {showFull &&
          createPortal(
            <div
              className="fixed inset-0 z-[80] flex items-center justify-center bg-black/90 p-4"
              onClick={(e) => {
                e.stopPropagation()
                setShowFull(false)
              }}
            >
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setShowFull(false)
                }}
                aria-label={t('common.close')}
                title={t('common.close')}
                className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
              >
                <CloseIcon className="h-5 w-5" />
              </button>
              {/* La foto guardada es un cuadrado (la recorta así
                  AvatarCropper.tsx, en un círculo pero sobre un lienzo
                  cuadrado — al exportarla a JPEG, que no admite
                  transparencia, las esquinas fuera del círculo quedan
                  rellenas de negro dentro del propio archivo). En el
                  avatar pequeño no se nota porque el círculo lo recorta
                  el CSS (rounded-full), pero aquí, al ampliarla, se
                  aplica ese mismo recorte: aspect-square + object-cover
                  fuerza un marco cuadrado y rounded-full lo redondea a
                  círculo, así se ve exactamente la misma foto de perfil
                  de siempre, solo que más grande — nunca el cuadrado con
                  las esquinas negras. */}
              {/* eslint-disable-next-line jsx-a11y/alt-text */}
              <img
                src={avatarUrl}
                alt={username}
                className="aspect-square max-h-[75vh] max-w-[85vw] rounded-full object-cover"
                onClick={(e) => e.stopPropagation()}
              />
            </div>,
            document.body,
          )}
      </>
    )
  }

  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-full font-semibold text-white ${className}`}
      style={{
        width: size,
        height: size,
        backgroundColor: colorForName(username || '?'),
        fontSize: Math.max(10, size * 0.4),
      }}
      aria-label={username}
    >
      {initials(username)}
    </div>
  )
}
