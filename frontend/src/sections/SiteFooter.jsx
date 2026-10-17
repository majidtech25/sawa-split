import Brand from "../components/Brand"
import { LIVE_DEMO_PRICE_CARD } from "../data/liveDemo"

// Navy, like the logo's tile. On it the site's dark green would fail contrast, so links
// are white and underlined, and text is white or 80% white (both well above 4.5:1).
const footerLink =
  "inline-flex min-h-11 items-center text-white underline underline-offset-2 hover:no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"

export default function SiteFooter() {
  return (
    <footer className="bg-[#1B2A41] px-6 py-10">
      <div className="mx-auto flex max-w-5xl flex-col items-center gap-3 text-center text-sm text-white/80">
        <Brand onDark className="text-base text-white" />
        <p>Built for the Future Leaders Challenge Eastern Africa.</p>
        <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
          <a href={LIVE_DEMO_PRICE_CARD} className={footerLink}>
            Live demo
          </a>
        </div>
        <p className="text-xs">
          Photo by{" "}
          <a href="https://unsplash.com/@spliff_dj_joe" target="_blank" rel="noopener noreferrer" className={footerLink}>
            Dwayne joe
          </a>{" "}
          on{" "}
          <a href="https://unsplash.com/photos/dnhm5nzXGl4" target="_blank" rel="noopener noreferrer" className={footerLink}>
            Unsplash
          </a>
          , Nairobi, Kenya.
        </p>
      </div>
    </footer>
  )
}
