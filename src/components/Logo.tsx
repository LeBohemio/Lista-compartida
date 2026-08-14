export default function Logo({ size = 56, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="Listas en Común"
    >
      <defs>
        <linearGradient id="logo-bg" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#6366f1" />
          <stop offset="1" stopColor="#4338ca" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill="url(#logo-bg)" />
      {/* back card */}
      <rect x="15" y="15" width="34" height="38" rx="6" fill="#ffffff" fillOpacity="0.35" />
      {/* front card */}
      <rect x="11" y="11" width="34" height="38" rx="6" fill="#ffffff" />
      <rect x="17" y="20" width="22" height="3.4" rx="1.7" fill="#4f46e5" />
      <rect x="17" y="28.5" width="22" height="3.4" rx="1.7" fill="#4f46e5" />
      <circle cx="20.5" cy="39.5" r="5" fill="#6366f1" />
      <path
        d="M18.3 39.6l1.6 1.6 3.1-3.4"
        stroke="#ffffff"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <rect x="28.5" y="38" width="10.5" height="3" rx="1.5" fill="#4f46e5" fillOpacity="0.55" />
    </svg>
  )
}
