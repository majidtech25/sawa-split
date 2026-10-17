import { ShieldCheck } from "lucide-react"
import Brand from "../components/Brand"
import PriceTransparencyCard from "../components/PriceTransparencyCard"
import { LinkButton, ScrollButton } from "../components/Button"
import { demoTransaction } from "../data/demoTransaction"
import { BRAND_BACKGROUND } from "../lib/brandBackground"

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

export default function Hero() {
  return (
    <div style={BRAND_BACKGROUND}>
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
