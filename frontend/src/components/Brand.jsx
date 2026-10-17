// The logo (public/logo.svg) before the "Sawa Split" wordmark. The logo is decorative
// (alt=""): the wordmark beside it is the name. Its colours are the logo's own; the
// wordmark keeps the site's.
export default function Brand({ size = 28, onDark = false, className = "" }) {
  return (
    <span className={`inline-flex items-center gap-2 whitespace-nowrap font-bold tracking-tight ${className}`}>
      <img src="/logo.svg" alt="" width={size} height={size} className="shrink-0" />
      <span>
        Sawa <span className={onDark ? "text-[#9FD8B5]" : "text-sawa-green"}>Split</span>
      </span>
    </span>
  )
}
