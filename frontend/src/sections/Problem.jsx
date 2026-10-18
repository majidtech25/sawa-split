import talekRiver from "../assets/talek-river.webp"

// The boma figures: "A Scandal in Maasailand that Cheats both Communities and Tourists",
// Prescott College students, Maasai Cultural Preservation Project, June 2005. Early 1990s:
// about KSh 2,000 per vehicle, the village kept about half. 2005: about $20 per person,
// the village kept KSh 300 (US$3.50), 17.5%.
const SOURCE = "https://maasaicpp.wordpress.com/wp-content/uploads/2009/02/culturalboma.pdf"

// The background: "Talek River at Talek, Kenya" by Daniel Case (CC BY-SA 4.0), taken from
// the bridge near Talek gate. Cropped to leave out the one person in the original, then
// toned and compressed; the edited file stays CC BY-SA 4.0. It is not the 2005 study
// village, and the caption doesn't say it is.
const PHOTO_PAGE = "https://commons.wikimedia.org/wiki/File:Talek_River_at_Talek,_Kenya.jpg"
const PHOTO_LICENCE = "https://creativecommons.org/licenses/by-sa/4.0/"

const lightLink = "text-white underline underline-offset-2 hover:no-underline"

export default function Problem() {
  return (
    <section id="problem" className="relative isolate scroll-mt-16 overflow-hidden bg-[#1B2A41] px-6 py-16 md:py-20">
      <img src={talekRiver} alt="" className="absolute inset-0 -z-10 h-full w-full object-cover" />
      {/* Dark navy over the photo, so white text stays well above 4.5:1 on every part of it. */}
      <div aria-hidden="true" className="absolute inset-0 -z-10 bg-[#1B2A41]/80" />
      <div className="mx-auto max-w-3xl text-center">
        <p className="font-mono text-4xl font-bold leading-tight tabular-nums text-white md:text-6xl">
          KSh 300 of every $20 paid at the gate
        </p>
        <p className="mx-auto mt-6 max-w-2xl text-base text-white/90">
          In 2005, a Maasai village kept about KSh 300 (US$3.50) of the $20 each
          tourist paid at the boma gate, less than a fifth. In the early 1990s it
          kept about half. The rest went to a commission chain the tourist never
          saw. Sawa Split makes that chain visible.
        </p>
        <p className="mt-4 text-xs text-white/85">
          Source:{" "}
          <a href={SOURCE} target="_blank" rel="noopener noreferrer" className={lightLink}>
            "A Scandal in Maasailand that Cheats both Communities and Tourists"
          </a>
          , Prescott College students, Maasai Cultural Preservation Project, June 2005 (PDF).
        </p>
        <p className="mt-8 text-xs text-white/85">
          Near Talek gate, Maasai Mara.{" "}
          <a href={PHOTO_PAGE} target="_blank" rel="noopener noreferrer" className={lightLink}>
            Photo: Daniel Case
          </a>
          ,{" "}
          <a href={PHOTO_LICENCE} target="_blank" rel="noopener noreferrer" className={lightLink}>
            CC BY-SA 4.0
          </a>
          ; cropped, toned and compressed.
        </p>
      </div>
    </section>
  )
}
