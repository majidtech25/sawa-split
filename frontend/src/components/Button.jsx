const base =
  "inline-flex items-center gap-2 rounded-sawa border border-sawa-green px-4 py-2 text-sm font-medium text-sawa-green transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sawa-green"

export function LinkButton({ href, children, external = false, className = "" }) {
  return (
    <a
      href={href}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      className={`${base} hover:bg-sawa-green hover:text-white ${className}`}
    >
      {children}
    </a>
  )
}

export function DisabledButton({ children, className = "" }) {
  return (
    <span
      aria-disabled="true"
      className={`${base} cursor-not-allowed opacity-40 ${className}`}
    >
      {children}
    </span>
  )
}
