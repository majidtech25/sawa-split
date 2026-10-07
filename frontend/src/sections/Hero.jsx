import PriceTransparencyCard from "../components/PriceTransparencyCard"
import { LinkButton } from "../components/Button"
import { demoTransaction } from "../data/demoTransaction"

// The signed demo price card from docs/DEMO_SCRIPT.md: Wanjiru Beadwork, KSh 100 +
// KSh 10, referred by the demo driver. The signature only checks out against an API
// running with the CHECKOUT_LINK_SECRET it was signed with.
const DEMO_PRICE_CARD =
  "#/pay/5ca4e79d-b462-4417-bd12-bd61eb9c1e10?product=100&photo=10&driver=QR-DRIVER-001&sig=4f2bb7cd0c75bedd91dbc67e6edb625121a1f32b190c5262354ee2cf5bef3bac"

export default function Hero() {
  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-12 px-6 py-16 md:flex-row md:items-center md:py-24">
      <div className="flex-1">
        <h1 className="text-3xl font-semibold leading-tight text-sawa-text md:text-4xl">
          A transparent, point-of-sale value-split app that routes tourist
          payments directly to the women and PWD producers and drivers who
          created the value
        </h1>
        <p className="mt-4 max-w-lg text-base text-sawa-text-muted">
          Every shilling a tourist pays for a craft, meal, or photo goes
          straight to the maker and the driver who earned it — split
          automatically, disclosed before you pay. No platform fee, ever.
        </p>
        <div className="mt-8 flex flex-wrap gap-4">
          <LinkButton href={DEMO_PRICE_CARD}>See it work</LinkButton>
          <LinkButton
            href="https://claude.ai/artifact/PWnxWEpT7X36HCYXYCGj1D"
            external
          >
            Read the rulebook
          </LinkButton>
        </div>
      </div>
      <div className="flex flex-1 justify-center md:justify-end">
        <PriceTransparencyCard {...demoTransaction} />
      </div>
    </section>
  )
}
