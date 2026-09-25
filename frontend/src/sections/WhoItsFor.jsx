import whoItsForPhoto from "../assets/who-its-for.jpg"

const personas = [
  {
    name: "Tourist",
    blurb:
      "Sees exactly where the money goes, and pays in one step with M-Pesa.",
  },
  {
    name: "Producer (Maker)",
    blurb:
      "A woman or PWD artisan, cook, or performer — gets a guaranteed, transparent share with no dependency on a driver handing over cash.",
  },
  {
    name: "Driver / Guide",
    blurb:
      "Earns a disclosed, guaranteed referral fee instead of pressuring a sale.",
  },
  {
    name: "Coordinator",
    blurb:
      "Onboards producers and drivers, watches the ledger, and resolves disputes.",
  },
]

export default function WhoItsFor() {
  return (
    <section className="relative isolate overflow-hidden bg-sawa-green px-6 py-16">
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
          {personas.map((persona) => (
            <div
              key={persona.name}
              className="rounded-sawa border border-sawa-border bg-sawa-surface p-5"
            >
              <h3 className="text-sm font-semibold text-sawa-text">
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
