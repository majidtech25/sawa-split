import { useEffect, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { Check, Compass, Hand, Wallet } from "lucide-react"
import PriceTransparencyCard from "../components/PriceTransparencyCard"
import { PayButton, Screen, SecondaryButton, StatusBadge, VerifiedStamp } from "../components/ui"
import { cardProps } from "../lib/checkout"
import { ksh } from "../lib/format"

// A walkthrough of a tourist's checkout with sample data, entirely in this page: it
// calls no API (no payment, sale or tour endpoint) and writes nothing to storage (no
// tour pass). The numbers follow the real rules: the guide gets the maker's 30% of the
// agreed price rounded down, the maker the rest plus the photo fee (never split).
const SALE = { maker: "Wanjiru Beadwork", makerFirst: "Wanjiru", site: "Talek gate", amount: 700, photo: 10, pct: 30 }
const GUIDE = { name: "James", type: "Driver" }

function split(withGuide) {
  const guide = withGuide ? Math.floor((SALE.amount * SALE.pct) / 100) : 0
  return { guide, maker: SALE.amount - guide + SALE.photo, total: SALE.amount + SALE.photo }
}

const STEPS = ["Your guide", "Checkout", "Receipt", "Split credited"]

function Progress({ step }) {
  return (
    <ol className="flex gap-1" aria-label="Demo steps">
      {STEPS.map((label, i) => (
        <li key={label} className="flex-1" aria-current={i === step ? "step" : undefined}>
          <div className={`h-1 rounded-sawa ${i <= step ? "bg-sawa-green" : "bg-sawa-border"}`} />
          <span className={`mt-1 block text-[11px] ${i === step ? "font-semibold text-sawa-text" : "text-sawa-text-muted"}`}>
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
  // ?step=0..3 opens a step directly, with James kept as the guide (for links and screenshots).
  const [search] = useSearchParams()
  const start = Math.min(Math.max(Number.parseInt(search.get("step"), 10) || 0, 0), STEPS.length - 1)
  const [step, setStep] = useState(start)
  const [withGuide, setWithGuide] = useState(start >= 2 || search.get("guide") === "yes" ? true : null) // null until "Still with James?" is answered
  const [paying, setPaying] = useState(false)
  const s = split(withGuide !== false)

  // "Pay" waits a moment, as the real M-Pesa prompt would, then shows the receipt.
  useEffect(() => {
    if (!paying) return undefined
    const timer = setTimeout(() => {
      setPaying(false)
      setStep(2)
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
    <>
      <div role="note" className="sticky top-0 z-10 bg-sawa-text px-4 py-2 text-center text-sm font-semibold text-white">
        Demo — no real payment is made
      </div>
      <Screen className="flex flex-col gap-6">
        <Progress step={step} />

        {step === 0 && (
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
            <SecondaryButton className="mt-5 w-full" onClick={() => setStep(1)}>
              Use James as my guide today
            </SecondaryButton>
          </Card>
        )}

        {step === 1 && (
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
                  <SecondaryButton onClick={() => setWithGuide(true)}>Yes</SecondaryButton>
                  <SecondaryButton onClick={() => setWithGuide(false)}>No, I'm done</SecondaryButton>
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
                    <span className="text-sawa-text-muted">No guide: the maker gets everything.</span>
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
                    className="text-left text-sm text-sawa-text-muted underline-offset-2 hover:text-sawa-text hover:underline"
                  >
                    Change my answer
                  </button>
                )}
              </>
            )}
          </>
        )}

        {step === 2 && (
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
            <SecondaryButton className="w-full" onClick={() => setStep(3)}>
              See the split credited
            </SecondaryButton>
          </>
        )}

        {step === 3 && (
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
            <div className="flex flex-col gap-3 border-t border-sawa-border pt-5">
              <button
                type="button"
                onClick={() => navigate("/", { state: { scrollTo: "contact" } })}
                className="text-left text-[15px] font-semibold text-sawa-green underline-offset-2 hover:underline"
              >
                Try it with your own team: contact us
              </button>
              <button type="button" onClick={restart} className="text-left text-sm text-sawa-text-muted underline-offset-2 hover:underline">
                Start the demo again
              </button>
            </div>
          </>
        )}
      </Screen>
    </>
  )
}
