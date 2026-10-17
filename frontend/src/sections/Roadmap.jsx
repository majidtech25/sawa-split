import { Check } from "lucide-react"

const phases = [
  {
    name: "Pilot",
    description:
      "One maker, one driver, one site — at least one real end-to-end transaction, logged and demonstrable.",
  },
  {
    name: "Local Scale",
    description:
      "Toward ten producers and more drivers at one site, on a shared live ledger.",
  },
  {
    name: "Multi-Site",
    description:
      "A registered cooperative and at least one additional validated site.",
  },
]

const horizons = [
  { name: "Now", live: true, items: ["Transparent split", "M-Pesa + cash", "Tours", "Batched payouts"] },
  { name: "Next", items: ["Find a verified guide near you"] },
  { name: "Later", items: ["More sites", "Kiswahili", "Multiple referrers per payment"] },
]

export default function Roadmap() {
  return (
    <section className="border-t border-sawa-border px-6 py-16 md:py-20">
      <div className="mx-auto max-w-4xl">
        <h2 className="text-center text-xl font-semibold text-sawa-text">
          Roadmap
        </h2>
        <div className="mt-10 grid gap-8 md:grid-cols-3">
          {phases.map((phase, i) => (
            <div key={phase.name} className="relative pl-6 md:pl-0">
              <div className="flex items-center gap-3 md:flex-col md:items-start md:gap-0">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sawa border border-sawa-green font-mono text-xs text-sawa-green">
                  {i + 1}
                </span>
                <h3 className="text-base font-semibold text-sawa-text md:mt-3">
                  {phase.name}
                </h3>
              </div>
              <p className="mt-2 text-sm text-sawa-text-muted">
                {phase.description}
              </p>
            </div>
          ))}
        </div>
        {/* SCOPE_V2 MUST 19: what's live, what's next, what's later. Next and Later are shown, not built. */}
        <div className="mt-12 grid gap-3 md:grid-cols-3">
          {horizons.map((h) => (
            <div key={h.name} className="rounded-sawa border border-sawa-border bg-sawa-surface p-4">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-sawa-text">
                {h.name}
                {h.live && (
                  <span className="inline-flex items-center gap-1 rounded-sawa border border-sawa-green px-1.5 text-xs font-medium text-sawa-green">
                    <Check aria-hidden="true" className="size-3" /> Live
                  </span>
                )}
              </h3>
              <ul className="mt-2 space-y-1 text-sm text-sawa-text-muted">
                {h.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
