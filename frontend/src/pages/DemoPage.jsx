import { useEffect, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { BadgeCheck, Check, ChevronRight, Compass, Hand, Wallet } from "lucide-react"
import PriceTransparencyCard from "../components/PriceTransparencyCard"
import { PayButton, SecondaryButton, StatusBadge, VerifiedStamp, tapTarget } from "../components/ui"
import { BRAND_BACKGROUND } from "../lib/brandBackground"
import { cardProps } from "../lib/checkout"
import { ksh } from "../lib/format"

// A walkthrough of a tourist's checkout with sample data, entirely in this page: it
// calls no API (no payment, sale or tour endpoint) and writes nothing to storage (no
// tour pass). The numbers follow the real rules: the guide gets the maker's 30% of the
// agreed price rounded down, the maker the rest plus the photo fee (never split).
const SALE = { maker: "Wanjiru Beadwork", makerFirst: "Wanjiru", site: "Talek gate", amount: 700, photo: 10, pct: 30 }
const GUIDE = { name: "James", type: "Driver" }
// "Find a verified guide near you" is the next step on the roadmap (SCOPE_V2 MUST 19):
// shown here as a static preview, not built. No ratings, map or reviews.
const NEARBY = [
  { name: "James", type: "Driver" },
  { name: "Hassan", type: "Agent" },
]

function split(withGuide) {
  const guide = withGuide ? Math.floor((SALE.amount * SALE.pct) / 100) : 0
  return { guide, maker: SALE.amount - guide + SALE.photo, total: SALE.amount + SALE.photo }
}

const STEPS = ["Find a guide", "Your guide", "Checkout", "Receipt", "Split credited"]

// "What's happening" beside each step: in full on wide screens; on phones only the
// first sentence, above the card.
const EXPLAIN = [
  "Coming next: tourists find coordinator-verified guides near them, so guides earn without touting.",
  "The tourist scans James's QR. His code is saved on their phone until midnight, so every stall they visit knows who brought them.",
  "Wanjiru types the agreed price. The server calculates the split — her share, James's referral and the photo fee — all shown before paying.",
  "The tourist pays by M-Pesa and Safaricom confirms it. In this demo, no money moves.",
  "Each share is credited the moment payment is confirmed. Payouts go to M-Pesa once a balance reaches KSh 500 (on request), or automatically at 18:00.",
]
const firstSentence = (text) => text.split(/(?<=\.)\s/)[0]

function Progress({ step }) {
  return (
    <ol className="flex gap-1" aria-label="Demo steps">
      {STEPS.map((label, i) => (
        <li key={label} className="flex-1" aria-current={i === step ? "step" : undefined}>
          <div className={`h-1 rounded-sawa ${i <= step ? "bg-white" : "bg-white/25"}`} />
          <span className={`mt-1 block text-[11px] ${i === step ? "font-semibold text-white" : "text-white/75"}`}>
            {label}
          </span>
        </li>
      ))}
    </ol>
  )
}

function Card({ children }) {
  return <section className="rounded-sawa border border-sawa-border bg-sawa-surface p-5">{children}</section>
}

export default function DemoPage() {
  const navigate = useNavigate()
  // ?step=0..4 opens a step directly (for links and screenshots): from the checkout on,
  // with James as the guide, or without him with ?guide=no.
  const [search] = useSearchParams()
  const start = Math.min(Math.max(Number.parseInt(search.get("step"), 10) || 0, 0), STEPS.length - 1)
  const [step, setStep] = useState(start)
  const [withGuide, setWithGuide] = useState(
    search.get("guide") === "no" ? false : start >= 3 || search.get("guide") === "yes" ? true : null,
  ) // null until "Still with James?" is answered
  const [paying, setPaying] = useState(false)
  const s = split(withGuide !== false)

  // "Pay" waits a moment, as the real M-Pesa prompt would, then shows the receipt.
  useEffect(() => {
    if (!paying) return undefined
    const timer = setTimeout(() => {
      setPaying(false)
      setStep(3)
    }, 1800)
    return () => clearTimeout(timer)
  }, [paying])

  const card = cardProps({
    site: SALE.site,
    producerName: SALE.makerFirst,
    driverName: withGuide ? GUIDE.name : null,
    product: { amount: SALE.amount, maker_amount: SALE.amount - s.guide, driver_amount: s.guide },
    photo: { amount: SALE.photo },
    total: s.total,
  })

  function restart() {
    setStep(0)
    setWithGuide(null)
    window.scrollTo({ top: 0 })
  }

  return (
    <div style={BRAND_BACKGROUND} className="min-h-screen">
      <div role="note" className="sticky top-[57px] z-10 bg-sawa-text px-4 py-2 text-center text-sm font-semibold text-white">
        Demo — no real payment is made
      </div>
      <div className="mx-auto max-w-[1000px] px-4 py-6 lg:px-8 lg:py-12">
        <Progress step={step} />
        <p className="mt-5 text-[15px] leading-snug text-white lg:hidden">{firstSentence(EXPLAIN[step])}</p>
        <div className="mt-5 grid items-start gap-8 lg:mt-8 lg:grid-cols-[420px_1fr] lg:gap-14">
          {/* The tourist's phone screen. */}
          <main className="flex flex-col gap-6 rounded-[24px] bg-white p-6 shadow-[0_12px_40px_rgba(0,0,0,0.25)] lg:p-8">

            {step === 0 && (
              <>
                <div>
                  <span className="inline-flex items-center rounded-sawa border border-dashed border-sawa-text-muted/60 px-2 py-0.5 text-xs font-semibold text-sawa-text-muted">
                    Preview — not live yet
                  </span>
                  <h1 className="mt-3 text-2xl font-semibold">Find your guide — coming next</h1>
                  <p className="mt-1 text-[15px] text-sawa-text-muted">
                    Verified guides at Talek gate. Every one was registered in person by a coordinator.
                  </p>
                </div>
                <ul className="flex flex-col gap-3">
                  {NEARBY.map((g) => {
                    const inner = (
                      <>
                        <div>
                          <div className="text-[15px] font-semibold text-sawa-text">
                            {g.name} · {g.type}
                          </div>
                          <div className="mt-1 inline-flex items-center gap-1 text-[13px] text-sawa-green">
                            <BadgeCheck aria-hidden="true" className="size-4" /> Coordinator-verified
                          </div>
                        </div>
                        {g.name === GUIDE.name ? (
                          <ChevronRight aria-hidden="true" className="size-5 shrink-0 text-sawa-green" />
                        ) : (
                          <span className="text-xs text-sawa-text-muted">This demo follows {GUIDE.name}</span>
                        )}
                      </>
                    )
                    const box = "flex w-full items-center justify-between gap-3 rounded-sawa border border-sawa-border bg-sawa-surface p-4 text-left"
                    return (
                      <li key={g.name}>
                        {g.name === GUIDE.name ? (
                          <button
                            type="button"
                            onClick={() => setStep(1)}
                            className={`${box} hover:border-sawa-green focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sawa-green`}
                          >
                            {inner}
                          </button>
                        ) : (
                          <div className={box}>{inner}</div>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </>
            )}

            {step === 1 && (
              <Card>
                <p className="text-[13px] text-sawa-text-muted">You scanned your guide's QR. Registered Sawa Split guide</p>
                <h1 className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xl font-semibold">
                  {GUIDE.name} · {GUIDE.type} ·{" "}
                  <span className="inline-flex items-center gap-1 text-sawa-green">
                    <Check aria-hidden="true" className="size-5" /> Active
                  </span>
                </h1>
                <p className="mt-3 text-[15px] text-sawa-text-muted">
                  James is running a tour today. Joining it means each stall's checkout shows his disclosed share.
                </p>
                <SecondaryButton className="mt-5 w-full" onClick={() => setStep(2)}>
                  Use James as my guide today
                </SecondaryButton>
              </Card>
            )}

            {step === 2 && (
              <>
                <div>
                  <h1 className="text-2xl font-semibold">{SALE.maker}</h1>
                  <p className="text-[15px] text-sawa-text-muted">{SALE.site} · beaded necklace</p>
                </div>
                {withGuide === null ? (
                  <Card>
                    <h2 className="text-lg font-semibold">Still with {GUIDE.name}?</h2>
                    <p className="mt-1 text-[13px] text-sawa-text-muted">
                      If {GUIDE.name} brought you here, he gets his disclosed share of this sale.
                    </p>
                    <div className="mt-4 flex flex-wrap gap-3">
                      <SecondaryButton onClick={() => setWithGuide(true)}>Yes, still with {GUIDE.name}</SecondaryButton>
                      <SecondaryButton onClick={() => setWithGuide(false)}>No, not with {GUIDE.name}</SecondaryButton>
                    </div>
                  </Card>
                ) : (
                  <>
                    <p className="text-[15px]">
                      {withGuide ? (
                        <span className="inline-flex items-center gap-2 text-sawa-green">
                          <Check aria-hidden="true" className="size-4" /> Guide · {GUIDE.name}
                        </span>
                      ) : (
                        <span className="text-sawa-text-muted">No guide, so {SALE.makerFirst} keeps 100%.</span>
                      )}
                    </p>
                    <PriceTransparencyCard {...card} />
                    <p className="text-[13px] text-sawa-text-muted">
                      {withGuide
                        ? `${GUIDE.name}'s share is the ${SALE.pct}% guide referral the maker agreed with the coordinator, rounded down to whole shillings. `
                        : ""}
                      Photo consent always goes to the maker in full. Nothing is taken out for Sawa Split.
                    </p>
                    <PayButton busy={paying} onClick={() => setPaying(true)}>
                      {paying ? "Waiting for the M-Pesa PIN…" : `Pay ${ksh(s.total)} (demo)`}
                    </PayButton>
                    <p className="-mt-3 text-[13px] text-sawa-text-muted">
                      In the real checkout an M-Pesa prompt opens on the tourist's phone. Here nothing is sent and nobody is
                      charged.
                    </p>
                    {!paying && (
                      <button
                        type="button"
                        onClick={() => setWithGuide(null)}
                        className={`${tapTarget} -mt-3 self-start text-left text-sm text-sawa-text-muted underline-offset-2 hover:text-sawa-text hover:underline`}
                      >
                        Change my answer
                      </button>
                    )}
                  </>
                )}
              </>
            )}

            {step === 3 && (
              <>
                <section aria-live="polite" className="flex items-center gap-5">
                  <VerifiedStamp amount={s.total} at={new Date().toISOString()} place={SALE.site} />
                  <div>
                    <StatusBadge status="confirmed" />
                    <h1 className="mt-2 text-2xl font-semibold">Payment confirmed</h1>
                    <p className="mt-1 text-[15px] text-sawa-text-muted">The split is recorded.</p>
                  </div>
                </section>
                <PriceTransparencyCard {...card} />
                <div className="flex flex-col gap-1 text-[13px] text-sawa-text-muted">
                  <p>
                    Receipt <span className="font-mono text-sawa-text">SS-DEMO0001</span> (sample)
                  </p>
                  <p>Nothing was taken out for Sawa Split.</p>
                </div>
                <SecondaryButton className="w-full" onClick={() => setStep(4)}>
                  See the split credited
                </SecondaryButton>
              </>
            )}

            {step === 4 && (
              <>
                <h1 className="text-2xl font-semibold">Split credited</h1>
                <div className="grid gap-3">
                  <Card>
                    <p className="flex items-center gap-2 text-sm font-semibold">
                      <Hand aria-hidden="true" className="size-4 text-sawa-green" /> {SALE.maker}'s dashboard
                    </p>
                    <p className="mt-2 font-mono text-3xl font-bold tabular-nums text-sawa-green">+{ksh(s.maker)}</p>
                    <p className="text-[13px] text-sawa-text-muted">
                      {ksh(SALE.amount - s.guide)} of the necklace + {ksh(SALE.photo)} photo consent
                    </p>
                  </Card>
                  {s.guide > 0 && (
                    <Card>
                      <p className="flex items-center gap-2 text-sm font-semibold">
                        <Compass aria-hidden="true" className="size-4 text-sawa-green" /> {GUIDE.name}'s dashboard
                      </p>
                      <p className="mt-2 font-mono text-3xl font-bold tabular-nums text-sawa-green">+{ksh(s.guide)}</p>
                      <p className="text-[13px] text-sawa-text-muted">His {SALE.pct}% referral, disclosed before the tourist paid</p>
                    </Card>
                  )}
                </div>
                <p className="flex items-start gap-2 text-[13px] text-sawa-text-muted">
                  <Wallet aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-sawa-green" />
                  Credited the moment the payment is confirmed. Once a balance reaches KSh 500, it's sent to M-Pesa on request,
                  or automatically at 18:00 each evening.
                </p>
                <div className="flex flex-col border-t border-sawa-border pt-3">
                  <button
                    type="button"
                    onClick={() => navigate("/", { state: { scrollTo: "contact" } })}
                    className={`${tapTarget} self-start text-left text-[15px] font-semibold text-sawa-green underline-offset-2 hover:underline`}
                  >
                    Try it with your own team: contact us
                  </button>
                  <button type="button" onClick={restart} className={`${tapTarget} self-start text-left text-sm text-sawa-text-muted underline-offset-2 hover:underline`}>
                    Start the demo again
                  </button>
                </div>
              </>
            )}
          </main>
          <aside aria-label="What's happening" className="hidden lg:block lg:pt-4">
            <h2 className="font-mono text-xs font-semibold uppercase tracking-wide text-white/75">What's happening</h2>
            <p className="mt-3 text-xl font-medium leading-relaxed text-white">{EXPLAIN[step]}</p>
          </aside>
        </div>
      </div>
    </div>
  )
}
