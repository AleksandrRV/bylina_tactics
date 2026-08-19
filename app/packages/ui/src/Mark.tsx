export function Mark({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 64 64"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="4" y="4" width="56" height="56" rx="6" fill="none" stroke="currentColor" strokeWidth="2.5" />
      <path
        d="M32 12 L48 32 L32 52 L16 32 Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinejoin="miter"
      />
      <circle cx="32" cy="32" r="4" fill="currentColor" />
    </svg>
  );
}
