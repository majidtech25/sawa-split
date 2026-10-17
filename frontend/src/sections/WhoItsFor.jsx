import { ClipboardCheck, Compass, Hand, Smartphone } from "lucide-react"
import whoItsForPhoto from "../assets/who-its-for.jpg"

const personas = [
  {
    icon: Smartphone,
    name: "Tourist",
    blurb:
      "Sees exactly where the money goes, and pays in one step with M-Pesa.",
  },
  {
    icon: Hand,
    name: "Producer (Maker)",
    blurb:
      "A woman or PWD artisan, cook, or performer — gets a guaranteed, transparent share with no dependency on a driver handing over cash.",
  },
  {
    icon: Compass,
    name: "Guides, drivers and agents",
    blurb:
      "Earn a visible, guaranteed commission, including young agents who used to rely on hidden markups.",
  },
  {
    icon: ClipboardCheck,
    name: "Coordinator",
    blurb:
      "Onboards makers and guides in person, watches the ledger, and resolves disputes.",
  },
]

export default function WhoItsFor() {
  return (
    <section className="relative isolate overflow-hidden bg-sawa-green px-6 py-16 md:py-20">
      <img
        src={whoItsForPhoto}
        alt="Two craftspeople working on a textile piece, Nairobi, Kenya"
        className="absolute inset-0 h-full w-full object-cover opacity-45 mix-blend-luminosity"
      />
      <div className="absolute inset-0 bg-sawa-green/55" />
      <div className="relative mx-auto max-w-5xl">
        <h2 className="text-center text-xl font-semibold text-white">
          Who it's for
        </h2>
        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          {personas.map(({ icon: Icon, ...persona }) => (
            <div
              key={persona.name}
              className="rounded-sawa border border-sawa-border bg-sawa-surface p-5"
            >
              <h3 className="flex items-center gap-2.5 text-sm font-semibold text-sawa-text">
                <Icon size={20} strokeWidth={1.75} aria-hidden="true" className="shrink-0 text-sawa-green" />
                {persona.name}
              </h3>
              <p className="mt-2 text-sm text-sawa-text-muted">
                {persona.blurb}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
