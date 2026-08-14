import { colorForName } from '../lib/colors'

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
}: {
  username: string
  avatarUrl?: string | null
  size?: number
  className?: string
}) {
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={username}
        width={size}
        height={size}
        className={`shrink-0 rounded-full object-cover ${className}`}
        style={{ width: size, height: size }}
      />
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
