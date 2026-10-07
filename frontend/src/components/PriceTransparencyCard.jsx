import { ksh } from "../lib/format"

function Amount({ children, className = "" }) {
  return <span className={`font-mono tabular-nums ${className}`}>{children}</span>
}

function ComponentRow({ label, amount, highlight = false }) {
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <span className="text-sawa-text-muted">{label}</span>
      <Amount className={highlight ? "text-sawa-green" : "text-sawa-text"}>{ksh(amount)}</Amount>
    </div>
  )
}

function ComponentCard({ label, amount, breakdown }) {
  return (
    <div className="rounded-sawa border border-sawa-border bg-sawa-surface p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-sawa-text">{label}</h3>
        <Amount className="text-base font-semibold text-sawa-text">{ksh(amount)}</Amount>
      </div>
      <div className="mt-3 space-y-1.5 border-t border-sawa-border pt-3">
        {breakdown.map((row) => (
          <ComponentRow key={row.label} {...row} />
        ))}
      </div>
    </div>
  )
}

// One card per active component, never a merged list — per UI_UX_DESIGN.md section 6.1.
export default function PriceTransparencyCard({ site, components, total, className = "" }) {
  return (
    <div className={`w-full max-w-[420px] rounded-sawa border border-sawa-border bg-sawa-bg p-4 shadow-sm ${className}`}>
      <p className="text-xs font-medium uppercase tracking-wide text-sawa-text-muted">{site}</p>
      <div className="mt-3 space-y-3">
        {components.map(({ key, ...component }) => (
          <ComponentCard key={key} {...component} />
        ))}
      </div>
      <div className="mt-4 flex items-center justify-between border-t border-sawa-border pt-4">
        <span className="text-sm font-semibold text-sawa-text">Total</span>
        <Amount className="text-2xl font-bold text-sawa-text">{ksh(total)}</Amount>
      </div>
    </div>
  )
}
