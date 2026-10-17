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
        <p className="mt-10 text-center text-sm text-sawa-text-muted">
          <span className="font-semibold text-sawa-text">Next:</span> per-member group payouts, Kiswahili, instant M-Pesa
          payouts.
        </p>
      </div>
    </section>
  )
}
