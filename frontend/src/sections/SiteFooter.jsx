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
        {/* Required by the licence of the problem section's photo (CC BY-SA 4.0): keep it. */}
        <p className="text-xs text-white/75">
          <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener noreferrer" className={`${footerLink} !text-white/75`}>
            Photo: Daniel Case, CC BY-SA 4.0, edited
          </a>
        </p>
      </div>
    </footer>
  )
}
