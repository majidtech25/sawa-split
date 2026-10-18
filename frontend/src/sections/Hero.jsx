import { LinkButton, ScrollButton } from "../components/Button"
import hero1717 from "../assets/hero-1717.webp"
import hero960 from "../assets/hero-960.webp"

// The hero's photo: a sunset craft stall with a phone showing the checkout, on the right.
// An approved exception to the homepage's "no photo in the hero" rule (CLAUDE.md 7.1).
// Decorative (alt=""): the text says what matters. The phone stays in view: on wide
// screens the text sits on a navy gradient that fades out before it. On phones the photo
// is behind the text too, filling the lower part of a full-screen hero (scaled to the
// screen's height, the phone would otherwise always sit right behind the text), with a
// top-to-bottom navy gradient so the text up top stays readable and the phone shows below.
// Below 380px (e.g. 360px phones) the text is a touch smaller and the photo a little lower,
// so the buttons stay clear of the phone's screen.
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
    <section className="relative isolate flex min-h-[calc(100svh-57px)] flex-col overflow-hidden bg-[#1B2A41] lg:min-h-[85vh] lg:flex-row lg:items-center">
      {/* Wide screens: the photo fills the hero, anchored right so the phone and stall show. */}
      <HeroImage className="absolute inset-0 -z-10 hidden h-full w-full object-cover object-[80%_center] lg:block" />
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 hidden lg:block"
        style={{ background: "linear-gradient(90deg, rgba(27,42,65,0.88) 0%, rgba(27,42,65,0.85) 40%, rgba(27,42,65,0) 60%)" }}
      />

      {/* Phones and tablets: the photo in the lower part, its top edge fading into the navy. */}
      <div
        aria-hidden="true"
        className="absolute inset-x-0 bottom-0 -z-10 h-[62%] max-[380px]:h-[57%] lg:hidden"
        style={{ WebkitMaskImage: "linear-gradient(to bottom, transparent 0%, #000 22%)", maskImage: "linear-gradient(to bottom, transparent 0%, #000 22%)" }}
      >
        <HeroImage className="h-full w-full object-cover object-[85%_center]" />
      </div>
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 lg:hidden"
        style={{ background: "linear-gradient(180deg, rgba(27,42,65,0.9) 0%, rgba(27,42,65,0.6) 45%, rgba(27,42,65,0) 100%)" }}
      />

      <div className="mx-auto w-full max-w-[1200px] px-6 pb-10 pt-10 max-[380px]:pt-6 lg:px-8 lg:py-24">
        <div className="max-w-xl lg:w-[46%]">
          <p className="text-sm font-semibold uppercase tracking-wide text-white/85">Fair pay for Kenya's makers and guides</p>
          <h1 className="mt-3 text-[2rem] font-semibold leading-tight text-white max-[380px]:text-[1.75rem] sm:text-4xl md:text-5xl">Every shilling has an address.</h1>
          <p className="mt-5 text-base text-white/90 max-[380px]:mt-4 max-[380px]:text-[15px] md:text-lg">
            Tourists scan a stall's QR, see exactly who earns what, and pay by M-Pesa. Sawa Split splits it on the spot.
            No platform fee.
          </p>
          <div className="mt-8 flex flex-wrap gap-4 max-[380px]:mt-6 max-[380px]:gap-3">
            <LinkButton href="#/demo" variant="onDarkFilled">
              Try the demo
            </LinkButton>
            <ScrollButton target="contact" variant="onDarkOutline">
              Bring Sawa Split to your market
            </ScrollButton>
          </div>
        </div>
      </div>
    </section>
  )
}
