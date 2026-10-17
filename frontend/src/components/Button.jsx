const base =
  "inline-flex min-h-11 items-center gap-2 rounded-sawa border border-sawa-green px-4 py-2 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sawa-green"

// Outline by default; "filled" for the one primary action on a screen. Ochre stays the
// Pay button's alone (CLAUDE.md section 7), so a filled button is green. The "onDark"
// pair is for the homepage hero's navy background only.
const VARIANTS = {
  outline: "text-sawa-green hover:bg-sawa-green hover:text-white",
  filled: "bg-sawa-green text-white hover:bg-[#164a2f]",
  onDarkFilled: "!border-white bg-white text-[#1B2A41] hover:bg-white/90 focus-visible:!outline-white",
  onDarkOutline: "!border-white text-white hover:bg-white hover:text-[#1B2A41] focus-visible:!outline-white",
}

export function LinkButton({ href, children, external = false, variant = "outline", className = "" }) {
  return (
    <a
      href={href}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      className={`${base} ${VARIANTS[variant]} ${className}`}
    >
      {children}
    </a>
  )
}

// Scrolls to a section of the same page. A button, not an #anchor link: the app uses
// HashRouter, so a "#section" href would be read as a route.
export function ScrollButton({ target, children, variant = "outline", className = "" }) {
  return (
    <button
      type="button"
      onClick={() => document.getElementById(target)?.scrollIntoView({ behavior: "smooth", block: "start" })}
      className={`${base} ${VARIANTS[variant]} ${className}`}
    >
      {children}
    </button>
  )
}

export function DisabledButton({ children, className = "" }) {
  return (
    <span
      aria-disabled="true"
      className={`${base} cursor-not-allowed text-sawa-green opacity-40 ${className}`}
    >
      {children}
    </span>
  )
}
