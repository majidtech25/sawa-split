import { Eye, ScanLine, Split, Wallet } from "lucide-react"

const steps = [
  {
    icon: ScanLine,
    label: "Scan the stall",
    description: "Every stall has its own QR. The tourist scans it and the seller's sale appears, priced in shillings.",
  },
  {
    icon: Eye,
    label: "See every share",
    description:
      "Before paying, the tourist sees who earns what: the maker, the guide who brought them, and photo consent, which always goes to the maker in full.",
  },
  {
    icon: Split,
    label: "Pay, and it splits",
    description:
      "By M-Pesa or cash. Sawa Split splits it at the moment of payment and credits the maker's share. Nothing is taken out for Sawa Split.",
  },
]

export default function Solution() {
  return (
    <section id="how-it-works" className="scroll-mt-4 px-6 py-16 md:py-20">
      <div className="mx-auto max-w-5xl">
        <h2 className="text-center text-xl font-semibold text-sawa-text">How it works</h2>
        <ol className="mt-10 grid gap-8 md:grid-cols-3">
          {steps.map(({ icon: Icon, label, description }, i) => (
            <li key={label} className="text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-sawa border border-sawa-green text-sawa-green">
                <Icon size={22} strokeWidth={1.75} aria-hidden="true" />
              </div>
              <h3 className="mt-4 text-base font-semibold text-sawa-text">
                <span className="font-mono text-sawa-text-muted">{i + 1}.</span> {label}
              </h3>
              <p className="mt-2 text-sm text-sawa-text-muted">{description}</p>
            </li>
          ))}
        </ol>
        <div className="mx-auto mt-10 flex max-w-2xl items-start gap-3 rounded-sawa border border-sawa-border bg-sawa-surface p-4">
          <Wallet size={20} strokeWidth={1.75} aria-hidden="true" className="mt-0.5 shrink-0 text-sawa-green" />
          <div>
            <h3 className="text-sm font-semibold text-sawa-text">Credited instantly, paid out daily</h3>
            <p className="mt-1 text-sm text-sawa-text-muted">
              Shares are credited the moment a payment is confirmed. Once they reach KSh 500, they're sent to M-Pesa on
              request, or automatically at 18:00 each evening.
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}
