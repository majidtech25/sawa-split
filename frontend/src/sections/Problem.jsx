// The boma figures: "A Scandal in Maasailand that Cheats both Communities and Tourists",
// Prescott College students, Maasai Cultural Preservation Project, June 2005. Early 1990s:
// about KSh 2,000 per vehicle, the village kept about half. 2005: about $20 per person,
// the village kept KSh 300 (US$3.50), 17.5%.
const SOURCE = "https://maasaicpp.wordpress.com/wp-content/uploads/2009/02/culturalboma.pdf"

export default function Problem() {
  return (
    <section className="border-t border-sawa-border bg-sawa-surface px-6 py-16 md:py-20">
      <div className="mx-auto max-w-3xl text-center">
        <p className="font-mono text-4xl font-bold leading-tight tabular-nums text-sawa-text md:text-6xl">
          KSh 300 of every $20 paid at the gate
        </p>
        <p className="mx-auto mt-6 max-w-2xl text-base text-sawa-text-muted">
          In 2005, a Maasai village kept about KSh 300 (US$3.50) of the $20 each
          tourist paid at the boma gate, less than a fifth. In the early 1990s it
          kept about half. The rest went to a commission chain the tourist never
          saw. Sawa Split makes that chain visible.
        </p>
        <p className="mt-4 text-xs text-sawa-text-muted">
          Source:{" "}
          <a href={SOURCE} target="_blank" rel="noopener noreferrer" className="text-sawa-green underline-offset-2 hover:underline">
            "A Scandal in Maasailand that Cheats both Communities and Tourists"
          </a>
          , Prescott College students, Maasai Cultural Preservation Project, June 2005 (PDF).
        </p>
      </div>
    </section>
  )
}
