import type { ReactNode, SVGProps } from 'react'

// Sistema de iconos "Insignia de cristal" (ver estudio de diseño): cada
// icono es un trazo de línea simple (mismo lenguaje que ya tenían los 4 de
// la barra de navegación — sin relleno, 1.8 de grosor, puntas y esquinas
// redondeadas) que vive dentro de su propia mini-tarjeta de cristal
// esmerilado (IconChip, más abajo). Un solo archivo para todos los dibujos
// de la app, en vez de emojis sueltos que cada teléfono pinta distinto.
//
// Para añadir un icono nuevo: copiar el patrón de cualquiera de los de
// abajo (viewBox 24x24, fill="none", stroke="currentColor") y envolverlo en
// <IconChip> donde se use — ver BottomNav.tsx para un ejemplo ya aplicado.

type IconProps = SVGProps<SVGSVGElement>

function Base({ children, ...props }: { children: ReactNode } & IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  )
}

export function ListsIcon(props: IconProps) {
  return (
    <Base {...props}>
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <path d="M9 3.5h6a1 1 0 0 1 1 1V6H8V4.5a1 1 0 0 1 1-1Z" />
      <path d="m8.5 11 1.5 1.5L12.5 10" />
      <path d="M14.5 11h3" />
      <path d="m8.5 15.5 1.5 1.5 2.5-2.5" />
      <path d="M14.5 15.5h3" />
    </Base>
  )
}

export function NotesIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M7 3.5h7l4 4V20a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z" />
      <path d="M14 3.5V7a1 1 0 0 0 1 1h3.5" />
      <path d="M8.5 12.5h7M8.5 15.5h7M8.5 18h4" />
    </Base>
  )
}

export function ContactsIcon(props: IconProps) {
  return (
    <Base {...props}>
      <rect x="4" y="3.5" width="16" height="17" rx="2.2" />
      <path d="M4 7.5h2M4 11h2M4 14.5h2" />
      <circle cx="14" cy="10.5" r="2.3" />
      <path d="M10.3 17c.5-2 1.9-3 3.7-3s3.2 1 3.7 3" />
    </Base>
  )
}

export function SettingsIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M4 6.5h9" />
      <circle cx="16" cy="6.5" r="2" />
      <path d="M4 12h4" />
      <circle cx="11" cy="12" r="2" />
      <path d="M13.5 12H20" />
      <path d="M4 17.5h9" />
      <circle cx="16" cy="17.5" r="2" />
    </Base>
  )
}

export function TrashIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M5 7h14" />
      <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
      <path d="M6.5 7l.8 12a2 2 0 0 0 2 1.9h5.4a2 2 0 0 0 2-1.9l.8-12" />
      <path d="M10 11v6M14 11v6" />
    </Base>
  )
}

export function EditIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M15 5l4 4" />
      <path d="M4 20l1-4.5L14.5 6 18 9.5 8.5 19z" />
    </Base>
  )
}

export function AddIcon(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 8v8M8 12h8" />
    </Base>
  )
}

export function CloseIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M6 6l12 12M18 6L6 18" />
    </Base>
  )
}

export function CheckIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </Base>
  )
}

export function MicIcon(props: IconProps) {
  return (
    <Base {...props}>
      <rect x="9" y="3.5" width="6" height="10" rx="3" />
      <path d="M6 11a6 6 0 0 0 12 0" />
      <path d="M12 17v3.5M9 20.5h6" />
    </Base>
  )
}

export function CameraIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2l1-2h7l1 2h2A1.5 1.5 0 0 1 20 8.5V18a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18Z" />
      <circle cx="12" cy="12.5" r="3.4" />
    </Base>
  )
}

export function GalleryIcon(props: IconProps) {
  return (
    <Base {...props}>
      <rect x="3.5" y="5" width="17" height="14" rx="2" />
      <circle cx="8.5" cy="9.5" r="1.6" />
      <path d="M4 16l5-5 4 4 3-3 4 4" />
    </Base>
  )
}

export function ShareIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M12 15V4M8.5 7.5 12 4l3.5 3.5" />
      <path d="M5 13v5.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V13" />
    </Base>
  )
}

export function BellIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M6 10a6 6 0 0 1 12 0c0 4 1.5 5.5 1.5 5.5H4.5S6 14 6 10Z" />
      <path d="M10 19a2 2 0 0 0 4 0" />
    </Base>
  )
}

export function BellOffIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M6 10a6 6 0 0 1 12 0c0 4 1.5 5.5 1.5 5.5H4.5S6 14 6 10Z" />
      <path d="M10 19a2 2 0 0 0 4 0" />
      <path d="M4 4l16 16" />
    </Base>
  )
}

export function ReplyIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M10 8l-5 4 5 4" />
      <path d="M5 12h9a5 5 0 0 1 5 5v1" />
    </Base>
  )
}

export function ForwardIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M14 8l5 4-5 4" />
      <path d="M19 12H10a5 5 0 0 0-5 5v1" />
    </Base>
  )
}

export function CopyIcon(props: IconProps) {
  return (
    <Base {...props}>
      <rect x="9" y="9" width="10.5" height="10.5" rx="2" />
      <path d="M14.5 9V6.5A2 2 0 0 0 12.5 4.5h-6a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2H9" />
    </Base>
  )
}

export function CalendarIcon(props: IconProps) {
  return (
    <Base {...props}>
      <rect x="4" y="5.5" width="16" height="14" rx="2" />
      <path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" />
    </Base>
  )
}

// Billete de banco: para "gastos" en vez del anterior icono de etiqueta de
// precio, que se prestaba a confusión con el propio precio de un artículo
// (PriceIcon, que sigue usándose ahí).
export function BanknoteIcon(props: IconProps) {
  return (
    <Base {...props}>
      <rect x="2.5" y="6.5" width="19" height="11" rx="2" />
      <circle cx="12" cy="12" r="2.6" />
      <path d="M5.5 9v.01M18.5 15v.01" />
    </Base>
  )
}

export function PriceIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M11 4h6a1 1 0 0 1 1 1v6l-8.5 8.5a1.5 1.5 0 0 1-2 0L4 17a1.5 1.5 0 0 1 0-2z" />
      <circle cx="15" cy="8" r="1.4" />
    </Base>
  )
}

// Chincheta clavada en ángulo (no un marcador de mapa — ver el feedback
// del estudio de diseño: el dibujo anterior parecía una ubicación).
export function PinIcon(props: IconProps) {
  return (
    <Base {...props}>
      <g transform="rotate(45 12 12)">
        <rect x="8" y="3" width="8" height="6" rx="2.5" />
        <path d="M10 9v3M14 9v3" />
        <path d="M12 12v7" />
      </g>
    </Base>
  )
}

export function MoreIcon(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="12" cy="6" r="1.3" />
      <circle cx="12" cy="12" r="1.3" />
      <circle cx="12" cy="18" r="1.3" />
    </Base>
  )
}

export function DragHandleIcon(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="9" cy="6.5" r="1.1" />
      <circle cx="15" cy="6.5" r="1.1" />
      <circle cx="9" cy="12" r="1.1" />
      <circle cx="15" cy="12" r="1.1" />
      <circle cx="9" cy="17.5" r="1.1" />
      <circle cx="15" cy="17.5" r="1.1" />
    </Base>
  )
}

export function ReorderIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M8 9l4-4 4 4" />
      <path d="M8 15l4 4 4-4" />
    </Base>
  )
}

export function SortAlphaIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M6 16V6M6 6L3.5 8.5M6 6l2.5 2.5" />
      <path d="M11 8h9M11 12h6M11 16h3" />
    </Base>
  )
}

export function NumberedListIcon(props: IconProps) {
  return (
    <Base {...props}>
      {/* "1" y "2" a la izquierda, como en cualquier icono de lista
          numerada, seguidos de una línea horizontal que representa cada
          fila de texto. */}
      <path d="M4.6 7.6v3.4" />
      <path d="M3.9 8.1 4.8 7.5" />
      <path d="M8 8.3h11" />
      <path d="M4 15c0-.7.6-1.2 1.3-1.2.7 0 1.3.5 1.3 1.1 0 .9-2.6 1.6-2.6 2.9h2.6" />
      <path d="M8 16.7h11" />
    </Base>
  )
}

export function PaletteIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M12 3.5c-4.7 0-8.5 3.6-8.5 8 0 3.4 2.6 4.6 4.4 4.6h1c.7 0 1.2.6 1.2 1.2 0 .3-.1.6-.3.8-.3.4-.5.8-.5 1.3 0 .8.8 1.6 2.2 1.6 4.7 0 8.5-3.9 8.5-8.7 0-4.9-3.8-8.8-8-8.8Z" />
      <circle cx="8.3" cy="10.3" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="8" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="15.7" cy="10.3" r="1.1" fill="currentColor" stroke="none" />
    </Base>
  )
}

export function HelpCircleIcon(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="12" cy="12" r="8.2" />
      <path d="M9.6 9.4c.2-1 1.1-1.7 2.2-1.7 1.2 0 2.2.8 2.2 1.9 0 1.4-2.2 1.6-2.2 3.2" />
      <path d="M12 16.4h.01" />
    </Base>
  )
}

export function FileAttachmentIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M7 3.5h7l4 4V19a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 19V5A1.5 1.5 0 0 1 7 3.5Z" />
      <path d="M14 3.5V7a1 1 0 0 0 1 1h3.5" />
      <path d="M9 13h6M9 16h4" />
    </Base>
  )
}

export function SortDateIcon(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7.5V12l3 2" />
    </Base>
  )
}

export function HandshakeIcon(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8.5 12.3l2.3 2.3 4.7-5" />
    </Base>
  )
}

export function BlockIcon(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M6.5 6.5l11 11" />
    </Base>
  )
}

export function ChatBubbleIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M4.5 6.5A2 2 0 0 1 6.5 4.5h11a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H9l-4 3v-3H6.5a2 2 0 0 1-2-2Z" />
    </Base>
  )
}

export function SendIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M20 4L10.5 13.5" />
      <path d="M20 4l-6 16-3.5-7L4 9.5z" />
    </Base>
  )
}

export function LockIcon(props: IconProps) {
  return (
    <Base {...props}>
      <rect x="5.5" y="10.5" width="13" height="9" rx="2" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    </Base>
  )
}

// Flecha curva de "deshacer/reactivar" (lista completada → volver a
// activarla). Distinta del check ✓ (CheckIcon), que es la acción contraria.
export function UndoIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M7 8H4V5" />
      <path d="M4.5 8.5A7.5 7.5 0 1 1 6 15.5" />
    </Base>
  )
}

export function ClockIcon(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7.5V12l3.2 1.8" />
    </Base>
  )
}

export function FolderIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M4 6.5A1.5 1.5 0 0 1 5.5 5h4l1.7 2H18.5A1.5 1.5 0 0 1 20 8.5v9A1.5 1.5 0 0 1 18.5 19h-13A1.5 1.5 0 0 1 4 17.5Z" />
    </Base>
  )
}

export function ChartIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M4.5 20V10M12 20V4M19.5 20v-7" />
      <path d="M4 20h16" />
    </Base>
  )
}

// Play/Pausa del reproductor de audio a medida (ver ChatPanel.tsx,
// VoiceMessagePlayer) — mismo lenguaje de trazo que el resto, nada de
// triángulos ni barras rellenas.
export function PlayIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M8 5.5v13l10-6.5-10-6.5Z" strokeLinejoin="round" />
    </Base>
  )
}

export function PauseIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M8 5v14M16 5v14" />
    </Base>
  )
}

/**
 * "Insignia de cristal" (propuesta B elegida): la mini-tarjeta de cristal
 * esmerilado que envuelve a cada icono. `active` cambia el cristal neutro
 * por el mismo degradado de acento + halo que ya usan el botón "Crear
 * lista", el mensaje propio del chat o la pestaña seleccionada — el mismo
 * lenguaje de "esto está seleccionado/es la acción principal" que ya existe
 * en el resto de la app, aplicado ahora también a los iconos.
 */
export function IconChip({
  children,
  active,
  size = 44,
  className = '',
}: {
  children: ReactNode
  active?: boolean
  size?: number
  className?: string
}) {
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-2xl transition ${
        active
          ? 'bg-gradient-to-br from-[var(--color-brand-500)] to-[var(--color-brand-600)] text-white shadow-[0_10px_20px_-10px_var(--color-glow)]'
          : 'glass-panel text-slate-500 dark:text-slate-400'
      } ${className}`}
      style={{ width: size, height: size }}
    >
      {children}
    </span>
  )
}
