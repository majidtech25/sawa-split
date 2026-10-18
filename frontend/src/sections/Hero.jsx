import { LinkButton, ScrollButton } from "../components/Button"
import hero1717 from "../assets/hero-1717.webp"
import hero960 from "../assets/hero-960.webp"

// The hero's photo: a sunset craft stall with a phone showing the checkout, on the right.
// An approved exception to the homepage's "no photo in the hero" rule (CLAUDE.md 7.1).
// Decorative (alt=""): the text says what matters. The phone stays in view: on wide
// screens the text sits on a navy gradient that fades out before it; on phones the text
// has its own navy band and the photo follows, anchored on the phone.
const HERO_SRCSET = `${hero960} 960w, ${hero1717} 1717w`

function HeroImage({ className }) {
  return (
    <img
      src={hero1717}
      srcSet={HERO_SRCSET}
      sizes="100vw"
      alt=""
      loading="eager"
      fetchPriority="high"
      className={className}
    />
  )
}

export default function Hero() {
  return (
    <section className="relative isolate overflow-hidden bg-[#1B2A41] lg:flex lg:min-h-[85vh] lg:items-center">
      {/* Wide screens: the photo fills the hero, anchored right so the phone and stall show. */}
      <HeroImage className="absolute inset-0 -z-10 hidden h-full w-full object-cover object-[80%_center] lg:block" />
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 hidden lg:block"
        style={{ background: "linear-gradient(90deg, rgba(27,42,65,0.88) 0%, rgba(27,42,65,0.85) 40%, rgba(27,42,65,0) 60%)" }}
      />

      <div className="mx-auto w-full max-w-[1200px] px-6 py-14 lg:px-8 lg:py-24">
        <div className="max-w-xl lg:w-[46%]">
          <p className="text-sm font-semibold uppercase tracking-wide text-white/85">Fair pay for Kenya's makers and guides</p>
          <h1 className="mt-3 text-4xl font-semibold leading-tight text-white md:text-5xl">Every shilling has an address.</h1>
          <p className="mt-5 text-base text-white/90 md:text-lg">
            Tourists scan a stall's QR, see exactly who earns what, and pay by M-Pesa. Sawa Split splits it on the spot.
            No platform fee.
          </p>
          <div className="mt-8 flex flex-wrap gap-4">
            <LinkButton href="#/demo" variant="onDarkFilled">
              Try the demo
            </LinkButton>
            <ScrollButton target="contact" variant="onDarkOutline">
              Bring Sawa Split to your market
            </ScrollButton>
          </div>
        </div>
      </div>

      {/* Phones and tablets: the photo below the text, anchored on the phone in it. */}
      <div className="relative aspect-[4/3] w-full lg:hidden">
        <HeroImage className="absolute inset-0 h-full w-full object-cover object-[78%_center]" />
      </div>
    </section>
  )
}
