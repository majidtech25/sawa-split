import { ClipboardCheck, Compass, Hand, Smartphone } from "lucide-react"
import whoItsForPhoto from "../assets/who-its-for.jpg"
import Section, { SectionHeading } from "../components/Section"

const personas = [
  {
    icon: Smartphone,
    name: "Tourist",
    blurb:
      "Sees exactly where the money goes, and pays in one step with M-Pesa.",
  },
  {
    icon: Hand,
    name: "Creator",
    blurb:
      "A woman or PWD artisan, cook, or performer — gets a guaranteed, transparent share with no dependency on a site intermediary handing over cash.",
  },
  {
    icon: Compass,
    name: "Site intermediaries",
    blurb:
      "Drivers, guides and agents earn a visible, guaranteed commission, including young agents who used to rely on hidden markups.",
  },
  {
    icon: ClipboardCheck,
    name: "Coordinator",
    blurb:
      "Onboards creators and site intermediaries in person, watches the ledger, and resolves disputes.",
  },
]

export default function WhoItsFor() {
  return (
    <Section id="who-its-for" className="relative isolate overflow-hidden bg-sawa-green">
      <img
        src={whoItsForPhoto}
        alt="Two craftspeople working on a textile piece, Nairobi, Kenya"
        className="absolute inset-0 -z-10 h-full w-full object-cover opacity-45 mix-blend-luminosity"
      />
      <div aria-hidden="true" className="absolute inset-0 -z-10 bg-sawa-green/55" />
      <div className="grid gap-10 lg:grid-cols-[4fr_8fr] lg:gap-16">
        <SectionHeading eyebrow="Who it's for" title="Four people, one fair split" onDark />
        <div className="grid gap-4 sm:grid-cols-2">
          {personas.map(({ icon: Icon, ...persona }) => (
            <div key={persona.name} className="rounded-sawa border border-sawa-border bg-sawa-surface p-5">
              <h3 className="flex items-center gap-2.5 text-sm font-semibold text-sawa-text">
                <Icon size={20} strokeWidth={1.75} aria-hidden="true" className="shrink-0 text-sawa-green" />
                {persona.name}
              </h3>
              <p className="mt-2 text-sm text-sawa-text-muted">{persona.blurb}</p>
            </div>
          ))}
        </div>
      </div>
    </Section>
  )
}
