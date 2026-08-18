export default function Logo({ size = 56, className = '' }: { size?: number; className?: string }) {
  return (
    <img
      src="/icons/icon-512.png"
      width={size}
      height={size}
      alt="NoteUs"
      className={className}
      style={{ width: size, height: size }}
    />
  )
}
