import { ShieldCheck } from "lucide-react"
import Brand from "../components/Brand"
import PriceTransparencyCard from "../components/PriceTransparencyCard"
import { LinkButton, ScrollButton } from "../components/Button"
import { demoTransaction } from "../data/demoTransaction"

// The checkout a tourist sees, in a phone outline: the product is the visual (CLAUDE.md 7.1).
function PhoneFrame({ children }) {
  return (
    <div className="w-full max-w-[340px] rounded-sawa border-[10px] border-sawa-text bg-sawa-bg shadow-[0_8px_32px_rgba(26,26,26,0.16)]">
      <div className="flex items-center justify-between border-b border-sawa-border px-3 py-2 text-xs">
        <Brand size={16} />
        <span className="inline-flex items-center gap-1 text-sawa-green">
          <ShieldCheck aria-hidden="true" className="size-3.5" /> Verified checkout
        </span>
      </div>
      <div className="p-3">{children}</div>
    </div>
  )
}

// The hero's background (homepage only, a deliberate exception to "no gradients", see
// CLAUDE.md 7.1): navy into sea teal, under a faint tile of the logo's bead colours. The
// text sits over the navy end, where white text keeps well above 4.5:1; the lightest teal
// is behind the phone mock-up, never behind text.
const BEADS = encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" fill-opacity="0.15">' +
    '<circle cx="8" cy="8" r="4" fill="#E4572E"/><circle cx="40" cy="8" r="4" fill="#FFB627"/>' +
    '<circle cx="24" cy="40" r="4" fill="#2E86DE"/><circle cx="56" cy="40" r="4" fill="#3BB273"/></svg>',
)
const HERO_BACKGROUND = {
  backgroundColor: "#1B2A41",
  backgroundImage: `url("data:image/svg+xml,${BEADS}"), linear-gradient(160deg, #1B2A41 0%, #1B2A41 38%, #1468A8 68%, #1FB5A8 100%)`,
}

export default function Hero() {
  return (
    <div style={HERO_BACKGROUND}>
      <section className="mx-auto flex max-w-6xl flex-col gap-12 px-6 py-16 md:flex-row md:items-center md:py-24">
        <div className="flex-1">
          <h1 className="text-4xl font-semibold leading-tight text-white md:text-5xl">
            Every shilling has an address.
          </h1>
          <p className="mt-5 max-w-lg text-base text-white/90 md:text-lg">
            Tourists scan a stall's QR, see exactly who earns what, and pay by
            M-Pesa. Sawa Split splits it on the spot. No platform fee.
          </p>
          <div className="mt-8 flex flex-wrap gap-4">
            <LinkButton href="#/demo" variant="onDarkFilled">
              Try the demo
            </LinkButton>
            <ScrollButton target="how-it-works" variant="onDarkOutline">
              How it works
            </ScrollButton>
          </div>
        </div>
        <div className="flex flex-1 justify-center md:justify-end">
          <PhoneFrame>
            <PriceTransparencyCard {...demoTransaction} className="shadow-none" />
          </PhoneFrame>
        </div>
      </section>
    </div>
  )
}
