import { CircleSlash, FileLock2, ScrollText, UserCheck } from "lucide-react"

// Each line is something the system enforces, not a promise (CLAUDE.md sections 4-5).
const reasons = [
  {
    icon: CircleSlash,
    name: "No platform fee",
    blurb: "Every shilling is the maker's or the guide's. Nothing is taken out for Sawa Split, ever.",
  },
  {
    icon: FileLock2,
    name: "Prices can't be changed",
    blurb: "Price cards are signed, so an edited price or guide is refused, and a sale's amount is fixed once the seller enters it.",
  },
  {
    icon: UserCheck,
    name: "Everyone verified in person",
    blurb: "A coordinator registers every maker and guide face to face. Nobody signs themselves up.",
  },
  {
    icon: ScrollText,
    name: "A permanent record",
    blurb: "Money moves on an append-only ledger, and every account action is on an audit log nobody can edit or delete.",
  },
]

export default function Trust() {
  return (
    <section className="px-6 py-16 md:py-20">
      <div className="mx-auto max-w-5xl">
        <h2 className="text-center text-xl font-semibold text-sawa-text">Why it can be trusted</h2>
        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          {reasons.map(({ icon: Icon, name, blurb }) => (
            <div key={name} className="rounded-sawa border border-sawa-border bg-sawa-surface p-5">
              <h3 className="flex items-center gap-2.5 text-sm font-semibold text-sawa-text">
                <Icon size={20} strokeWidth={1.75} aria-hidden="true" className="shrink-0 text-sawa-green" />
                {name}
              </h3>
              <p className="mt-2 text-sm text-sawa-text-muted">{blurb}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
