import { Eye, ScanLine, Split, Wallet } from "lucide-react"
import Section, { SectionHeading } from "../components/Section"

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
      "Before paying, the tourist sees who earns what: the creator, the site intermediary who brought them, and photo consent, which always goes to the creator in full.",
  },
  {
    icon: Split,
    label: "Pay, and it splits",
    description:
      "By M-Pesa or cash. Sawa Split splits it at the moment of payment and credits the creator's share. Nothing is taken out for Sawa Split.",
  },
]

export default function Solution() {
  return (
    <Section id="how-it-works">
      <div className="grid gap-10 lg:grid-cols-[5fr_7fr] lg:gap-16">
        <div>
          <SectionHeading eyebrow="How it works" title="Three steps at the stall" />
          <div className="mt-8 flex items-start gap-3 rounded-sawa border border-sawa-border bg-sawa-surface p-4">
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
        <ol className="flex flex-col gap-6">
          {steps.map(({ icon: Icon, label, description }, i) => (
            <li key={label} className="flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-sawa border border-sawa-green text-sawa-green">
                <Icon size={22} strokeWidth={1.75} aria-hidden="true" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-sawa-text">
                  <span className="font-mono text-sawa-text-muted">{i + 1}.</span> {label}
                </h3>
                <p className="mt-1 text-sm text-sawa-text-muted">{description}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </Section>
  )
}
