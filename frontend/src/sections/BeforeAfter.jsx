import Section, { SectionHeading } from "../components/Section"
// SCOPE_V2 MUST 19: where guides and tourists meet today, and the next step (shown, not built).
const rows = [
  { label: "Today", text: "Guides wait at the gate and approach tourists." },
  { label: "Next", text: "Tourists find verified guides — and every shilling still has an address." },
]

export default function BeforeAfter() {
  return (
    <Section className="border-t border-sawa-border bg-sawa-surface">
      <div className="grid gap-10 lg:grid-cols-[4fr_8fr] lg:gap-16">
        <SectionHeading eyebrow="What changes" title="From the gate to a verified guide" />
        <div className="grid gap-3 md:grid-cols-2">
          {rows.map((row) => (
            <div key={row.label} className="rounded-sawa border border-sawa-border bg-sawa-bg p-5">
              <div className="font-mono text-xs font-semibold uppercase tracking-wide text-sawa-green">{row.label}</div>
              <p className="mt-2 text-lg font-semibold leading-snug text-sawa-text">{row.text}</p>
            </div>
          ))}
        </div>
      </div>
    </Section>
  )
}
