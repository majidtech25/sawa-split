import { AlertTriangle, Banknote, Check, Clock, Flag, Hourglass } from "lucide-react"
import { eatTime, ksh } from "../lib/format"

const focusRing =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sawa-green"

// The payment flow never stretches past ~420px, even on desktop (UI_UX_DESIGN.md section 4).
export function Screen({ children, className = "" }) {
  return <main className={`mx-auto w-full max-w-[420px] px-4 py-8 ${className}`}>{children}</main>
}

export function Amount({ value, className = "" }) {
  return <span className={`font-mono tabular-nums ${className}`}>{ksh(value)}</span>
}

// Ochre has one job: the Pay button. Nothing else in the app uses it.
export function PayButton({ children, busy = false, ...props }) {
  return (
    <button
      type="button"
      {...props}
      disabled={busy || props.disabled}
      className={`w-full rounded-sawa bg-sawa-ochre px-4 py-3 text-[15px] font-semibold text-white transition-colors hover:bg-[#8c5a14] active:bg-[#8c5a14] disabled:cursor-not-allowed disabled:opacity-40 ${focusRing}`}
    >
      {children}
    </button>
  )
}

export function SecondaryButton({ children, className = "", type = "button", ...props }) {
  return (
    <button
      type={type}
      {...props}
      className={`inline-flex items-center justify-center gap-2 rounded-sawa border border-sawa-green px-4 py-2.5 text-sm font-semibold text-sawa-green transition-colors hover:bg-sawa-green hover:text-white disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-sawa-green ${focusRing} ${className}`}
    >
      {children}
    </button>
  )
}

export function Field({ id, label, hint, error, ...inputProps }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] text-sawa-text-muted">
        {label}
      </label>
      <input
        id={id}
        {...inputProps}
        aria-invalid={error ? "true" : undefined}
        aria-describedby={error || hint ? `${id}-note` : undefined}
        className={`rounded-sawa border bg-sawa-surface px-3 py-2.5 font-mono text-[15px] text-sawa-text outline-none focus:border-2 focus:border-sawa-green ${
          error ? "border-sawa-terracotta" : "border-sawa-border"
        }`}
      />
      {(error || hint) && (
        <p id={`${id}-note`} className={`text-xs ${error ? "text-sawa-terracotta" : "text-sawa-text-muted"}`}>
          {error || hint}
        </p>
      )}
    </div>
  )
}

// For words (reasons, notes), so Inter rather than Field's mono.
export function TextArea({ id, label, hint, error, rows = 3, ...inputProps }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] text-sawa-text-muted">
        {label}
      </label>
      <textarea
        id={id}
        rows={rows}
        {...inputProps}
        aria-invalid={error ? "true" : undefined}
        aria-describedby={error || hint ? `${id}-note` : undefined}
        className={`resize-y rounded-sawa border bg-sawa-surface px-3 py-2.5 text-[15px] text-sawa-text outline-none focus:border-2 focus:border-sawa-green ${
          error ? "border-sawa-terracotta" : "border-sawa-border"
        }`}
      />
      {(error || hint) && (
        <p id={`${id}-note`} className={`text-xs ${error ? "text-sawa-terracotta" : "text-sawa-text-muted"}`}>
          {error || hint}
        </p>
      )}
    </div>
  )
}

export function ErrorNote({ children }) {
  if (!children) return null
  return (
    <p role="alert" className="flex items-start gap-2 rounded-sawa border border-sawa-terracotta/40 bg-white p-3 text-sm text-sawa-terracotta">
      <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </p>
  )
}

function PendingDot() {
  return <span aria-hidden="true" className="size-2 animate-pulse rounded-full bg-sawa-text-muted motion-reduce:animate-none" />
}

// Every status is an icon AND a word, never color alone. The M-Pesa states keep
// the design system's three (pending / confirmed / failed); the cash states read as
// "still resolving", visibly different from both those and a dispute.
const STATUS = {
  initiated: { label: "Pending", icon: <PendingDot />, tone: "text-sawa-text-muted" },
  confirmed: { label: "Confirmed", icon: <Check aria-hidden="true" className="size-3.5" />, tone: "text-sawa-green" },
  failed: { label: "Failed", icon: <AlertTriangle aria-hidden="true" className="size-3.5" />, tone: "text-sawa-terracotta" },
  disputed: { label: "Disputed", icon: <Flag aria-hidden="true" className="size-3.5" />, tone: "text-sawa-text font-semibold" },
  cash_unconfirmed: {
    label: "Cash · confirming",
    icon: <Hourglass aria-hidden="true" className="size-3.5" />,
    tone: "text-sawa-text-muted",
    chip: "border border-dashed border-sawa-text-muted/50 rounded-sawa px-1.5",
  },
  cash_confirmed: { label: "Cash · confirmed", icon: <Banknote aria-hidden="true" className="size-3.5" />, tone: "text-sawa-green" },
  cash_expired: {
    label: "Cash · expired",
    icon: <Clock aria-hidden="true" className="size-3.5" />,
    tone: "text-sawa-text font-semibold",
    chip: "border border-sawa-text rounded-sawa px-1.5",
  },
  // withdrawals
  requested: { label: "Paying out", icon: <PendingDot />, tone: "text-sawa-text-muted" },
  processing: { label: "Paying out", icon: <PendingDot />, tone: "text-sawa-text-muted" },
  paid: { label: "Paid", icon: <Check aria-hidden="true" className="size-3.5" />, tone: "text-sawa-green" },
  retried: { label: "Retried", icon: <Clock aria-hidden="true" className="size-3.5" />, tone: "text-sawa-text-muted" },
}

export function StatusBadge({ status }) {
  const s = STATUS[status] || { label: status, icon: null, tone: "text-sawa-text-muted" }
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap text-[13px] ${s.tone} ${s.chip || ""}`}>
      {s.icon}
      {s.label}
    </span>
  )
}

// The one cultural motif (UI_UX_DESIGN.md section 7): a passport-style stamp, shown
// only on a confirmed transaction.
export function VerifiedStamp({ amount, at, place }) {
  return (
    <div
      role="img"
      aria-label={`Verified: ${ksh(amount)} at ${eatTime(at)}${place ? `, ${place}` : ""}`}
      className="relative flex size-36 shrink-0 items-center justify-center rounded-full border-[1.5px] border-sawa-green"
    >
      <div className="absolute inset-1.5 rounded-full border border-sawa-green/60" />
      <div className="text-center font-mono text-sawa-green">
        <div className="text-[10px] uppercase tracking-[0.1em]">Verified</div>
        <div className="my-0.5 text-[15px] font-bold tabular-nums">{ksh(amount)}</div>
        <div className="text-[10px] uppercase text-sawa-text-muted">
          {eatTime(at)}
          {place ? ` · ${place}` : ""}
        </div>
      </div>
    </div>
  )
}

export function LiveIndicator({ live }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] text-sawa-text-muted">
      <span
        aria-hidden="true"
        className={`size-2 rounded-full ${live ? "bg-sawa-green motion-safe:animate-pulse" : "bg-sawa-border"}`}
      />
      {live ? "Live" : "Connecting…"}
    </span>
  )
}
