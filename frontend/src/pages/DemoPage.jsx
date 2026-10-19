import { useEffect, useRef, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Banknote,
  Check,
  Compass,
  Hand,
  Laptop,
  QrCode,
  ScanLine,
  Smartphone,
  Users,
  Wallet,
} from "lucide-react"
import PriceTransparencyCard from "../components/PriceTransparencyCard"
import { PayButton, SecondaryButton, StatusBadge, VerifiedStamp, tapTarget } from "../components/ui"
import { BRAND_BACKGROUND } from "../lib/brandBackground"
import { cardProps } from "../lib/checkout"
import { ksh } from "../lib/format"

// A walkthrough of one sale from registration to reconciliation, with sample data,
// entirely in this page: it calls no API (no payment, sale, tour or withdrawal endpoint)
// and writes nothing to storage (no tour pass). The numbers follow the real rules: the
// guide gets the maker's 30% of the agreed price rounded down, the maker the rest plus
// the photo fee (never split); payouts are full-balance only, from KSh 500.
const SALE = { maker: "Wanjiru Beadwork", makerFirst: "Wanjiru", site: "Talek gate", item: "Beaded necklace", amount: 700, photo: 10, pct: 30 }
const GUIDE = { name: "James", type: "Driver", code: "JAMES", group: 4 }
const THRESHOLD = 500
// "Find a verified guide near you" is the next step on the roadmap (SCOPE_V2 MUST 19):
// shown here as a static preview, not built. No ratings, map or reviews.
const NEARBY = [
  { name: "James", type: "Driver" },
  { name: "Hassan", type: "Agent" },
]

function split(withGuide) {
  const guide = withGuide ? Math.floor((SALE.amount * SALE.pct) / 100) : 0
  return { guide, product: SALE.amount - guide, maker: SALE.amount - guide + SALE.photo, total: SALE.amount + SALE.photo }
}

// Whose screen each step shows.
const TOURIST = { label: "Tourist's phone", icon: Smartphone }
const WANJIRU = { label: "Wanjiru's phone", icon: Hand }
const JAMES = { label: "James's phone", icon: Compass }
const COORDINATOR = { label: "Coordinator's laptop", icon: Laptop }

// Each step: its progress label, whose screen it is, and "What's happening" beside it
// (on phones, above it). The text depends on whether the tourist is still with James.
const STEPS = [
  {
    label: "Register",
    screen: COORDINATOR,
    explain: () =>
      "A coordinator registers every maker and guide in person; there's no public sign-up. Wanjiru's guide referral is set here at 30%. It can never be more than 40%, so a maker always keeps at least 60% of the agreed price. Each gets a 4-digit PIN, handed over in person.",
  },
  {
    label: "Start tour",
    screen: JAMES,
    explain: () =>
      `James starts today's tour and says how many tourists are with him: ${GUIDE.group}. Only tourists who join his running tour earn him a referral. The tour ends at midnight, and once ${GUIDE.group} have joined, a fifth phone is refused.`,
  },
  {
    label: "Tour pass",
    screen: TOURIST,
    explain: () =>
      "The tourist scans James's QR card and taps \"Use James as my guide today\". The join is counted on James's tour, and the phone remembers James until midnight, so every stall they visit knows who brought them. No account, no app to install.",
  },
  {
    label: "New sale",
    screen: WANJIRU,
    explain: () =>
      `Wanjiru agrees a price with the tourist and types it on her phone: ${ksh(SALE.amount)}, plus ${ksh(SALE.photo)} photo consent because the tourist wants a photo of her at work. The sale is single-use and expires after 30 minutes.`,
  },
  {
    label: "Scan stall",
    screen: TOURIST,
    explain: (s, answered) =>
      answered === null
        ? `The tourist scans the QR on Wanjiru's stand and sees her sale. First the checkout asks: still with James? Yes gives James his disclosed 30% (${ksh(split(true).guide)}); No means no referral, and Wanjiru keeps 100% (${ksh(split(false).maker)}).`
        : s.guide
        ? `The tourist scans the QR on Wanjiru's stand and confirms they're still with James. The server works out the split before anyone pays: James gets 30% of the ${ksh(SALE.amount)}, rounded down (${ksh(s.guide)}); Wanjiru gets the rest plus the whole photo fee (${ksh(s.maker)}).`
        : `The tourist scans the QR on Wanjiru's stand. They're no longer with James, so there's no referral and the tour pass is cleared: Wanjiru keeps 100%, ${ksh(s.maker)}.`,
  },
  {
    label: "Pay",
    screen: TOURIST,
    explain: () =>
      "The tourist pays the total by M-Pesa: a PIN prompt opens on their own phone, and Safaricom confirms the payment to Sawa Split. Cash works too, but a cash sale only counts once two people have confirmed it.",
  },
  {
    label: "Receipt",
    screen: TOURIST,
    explain: () =>
      "The tourist's receipt shows the same breakdown they saw before paying. Nothing was taken out for Sawa Split: there is no platform fee, ever.",
  },
  {
    label: "Credited",
    screen: null, // both dashboards
    explain: (s) =>
      s.guide
        ? `The moment Safaricom confirms, each share is credited: Wanjiru ${ksh(s.maker)}, James ${ksh(s.guide)}. Both see it live on their own dashboards. Every entry is written once and never edited.`
        : `The moment Safaricom confirms, Wanjiru's ${ksh(s.maker)} is credited and shows live on her dashboard. Every entry is written once and never edited.`,
  },
  {
    label: "Payouts",
    screen: WANJIRU,
    explain: (s) =>
      `A balance goes to M-Pesa once it reaches ${ksh(THRESHOLD)}, always in full: on request with Withdraw, or automatically at 18:00 each evening. Wanjiru's ${ksh(s.maker)} qualifies now.${
        s.guide ? ` James's ${ksh(s.guide)} waits until his balance reaches ${ksh(THRESHOLD)}.` : ""
      }`,
  },
  {
    label: "Reconcile",
    screen: COORDINATOR,
    explain: () =>
      "The coordinator sees every shilling. What M-Pesa collected equals exactly what was credited to makers and guides: paid out plus still owed. Platform fee: KSh 0.",
  },
  {
    label: "Coming next",
    screen: TOURIST,
    explain: () =>
      "Next on the roadmap: tourists find a coordinator-verified guide near them, and a group checks in with its guide in one scan. Shown here as a preview; it isn't built yet.",
  },
]
const LAST = STEPS.length

function Progress({ step, go }) {
  const current = useRef(null)
  // On phones the bar scrolls sideways: keep the current step in view.
  useEffect(() => {
    current.current?.scrollIntoView?.({ inline: "center", block: "nearest" })
  }, [step])
  return (
    <nav aria-label="Demo steps" className="-mx-4 overflow-x-auto px-4 lg:mx-0 lg:px-0">
      <ol className="flex min-w-max gap-1 lg:min-w-0">
        {STEPS.map(({ label }, i) => {
          const n = i + 1
          return (
            <li key={label} ref={n === step ? current : undefined} className="w-[84px] lg:w-auto lg:flex-1">
              <button
                type="button"
                onClick={() => go(n)}
                aria-current={n === step ? "step" : undefined}
                className="flex min-h-11 w-full flex-col justify-start rounded-sawa pt-1 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              >
                <span className={`block h-1 w-full rounded-sawa ${n <= step ? "bg-white" : "bg-white/25"}`} />
                <span className={`mt-1 block text-xs ${n === step ? "font-semibold text-white" : "text-white/85"}`}>
                  <span className="font-mono tabular-nums">{n}</span> {label}
                </span>
              </button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

function Card({ children, className = "" }) {
  return <section className={`rounded-sawa border border-sawa-border bg-sawa-surface p-5 ${className}`}>{children}</section>
}

// A form field shown already filled in, as it would be on the real screen.
function Filled({ label, value, mono = false }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[13px] text-sawa-text-muted">{label}</span>
      <span className={`rounded-sawa border border-sawa-border bg-sawa-surface px-3 py-2.5 text-[15px] text-sawa-text ${mono ? "font-mono tabular-nums" : ""}`}>
        {value}
      </span>
    </div>
  )
}

function Row({ label, value, strong = false }) {
  return (
    <div className={`flex items-baseline justify-between gap-4 py-2 text-[15px] ${strong ? "font-semibold" : ""}`}>
      <span>{label}</span>
      <span className="font-mono tabular-nums">{value}</span>
    </div>
  )
}

function Done({ children }) {
  return (
    <p aria-live="polite" className="flex items-start gap-2 text-[15px] font-semibold text-sawa-green">
      <Check aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
      <span>{children}</span>
    </p>
  )
}

function Preview() {
  return (
    <span className="inline-flex items-center self-start rounded-sawa border border-dashed border-sawa-text-muted/60 px-2 py-0.5 text-xs font-semibold text-sawa-text-muted">
      Preview — not live yet
    </span>
  )
}

const linkButton = `${tapTarget} self-start text-left text-sm text-sawa-text-muted underline-offset-2 hover:text-sawa-text hover:underline`

// 1. The coordinator registers Wanjiru and James in person.
function Register() {
  return (
    <>
      <h1 className="text-2xl font-semibold">Register makers and guides</h1>
      <Card>
        <p className="flex items-center gap-2 text-sm font-semibold">
          <Hand aria-hidden="true" className="size-4 text-sawa-green" /> Maker
        </p>
        <div className="mt-3 grid gap-3">
          <Filled label="Name" value={SALE.maker} />
          <Filled label="Site" value={SALE.site} />
          <Filled label="Guide referral (max 40%)" value={`${SALE.pct}%`} mono />
          <Filled label="Photo consent fee" value={ksh(SALE.photo)} mono />
        </div>
        <p className="mt-3 text-[13px] text-sawa-text-muted">
          Stall code <span className="font-mono text-sawa-text">WANJIRU</span>, printed as the QR on her stand.
        </p>
      </Card>
      <Card>
        <p className="flex items-center gap-2 text-sm font-semibold">
          <Compass aria-hidden="true" className="size-4 text-sawa-green" /> Guide
        </p>
        <div className="mt-3 grid gap-3">
          <Filled label="Name" value={GUIDE.name} />
          <Filled label="Type" value={GUIDE.type} />
        </div>
        <p className="mt-3 text-[13px] text-sawa-text-muted">
          Referral code <span className="font-mono text-sawa-text">{GUIDE.code}</span>, printed as the QR on his card.
        </p>
      </Card>
      <Done>Both registered in person, each with a 4-digit PIN.</Done>
    </>
  )
}

// 2. James starts today's tour.
function StartTour() {
  const [started, setStarted] = useState(false)
  return (
    <>
      <div>
        <p className="text-[13px] text-sawa-text-muted">James's dashboard</p>
        <h1 className="mt-1 text-2xl font-semibold">Today's tour</h1>
      </div>
      <Card>
        {started ? (
          <div aria-live="polite">
            <p className="flex items-center gap-2 text-[15px] font-semibold text-sawa-green">
              <Users aria-hidden="true" className="size-5" /> Tour running
            </p>
            <p className="mt-2 font-mono text-2xl font-bold tabular-nums">0 of {GUIDE.group} joined</p>
            <p className="mt-1 text-[13px] text-sawa-text-muted">Ends at midnight, or when James taps End tour.</p>
          </div>
        ) : (
          <>
            <Filled label="How many tourists are with you today?" value={GUIDE.group} mono />
            <SecondaryButton className="mt-4 w-full" onClick={() => setStarted(true)}>
              Start tour
            </SecondaryButton>
          </>
        )}
      </Card>
    </>
  )
}

// 3. The tourist scans James's QR and takes him as their guide for the day.
function TourPass() {
  const [joined, setJoined] = useState(false)
  return (
    <Card>
      <p className="flex items-center gap-2 text-[13px] text-sawa-text-muted">
        <QrCode aria-hidden="true" className="size-4" /> You scanned your guide's QR. Registered Sawa Split guide
      </p>
      <h1 className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xl font-semibold">
        {GUIDE.name} · {GUIDE.type} ·{" "}
        <span className="inline-flex items-center gap-1 text-sawa-green">
          <Check aria-hidden="true" className="size-5" /> Active
        </span>
      </h1>
      {joined ? (
        <div className="mt-4 flex flex-col gap-2">
          <Done>{GUIDE.name} is your guide today.</Done>
          <p className="text-[13px] text-sawa-text-muted">
            Saved on this phone until midnight. James's tour: 1 of {GUIDE.group} joined. (In this demo nothing is saved.)
          </p>
        </div>
      ) : (
        <>
          <p className="mt-3 text-[15px] text-sawa-text-muted">
            James is running a tour today. Joining it means each stall's checkout shows his disclosed share.
          </p>
          <SecondaryButton className="mt-5 w-full" onClick={() => setJoined(true)}>
            Use James as my guide today
          </SecondaryButton>
        </>
      )}
    </Card>
  )
}

// 4. Wanjiru enters the agreed price.
function NewSale() {
  const [started, setStarted] = useState(false)
  const total = SALE.amount + SALE.photo
  return (
    <>
      <div>
        <p className="text-[13px] text-sawa-text-muted">Wanjiru's dashboard</p>
        <h1 className="mt-1 text-2xl font-semibold">New sale</h1>
      </div>
      <Card>
        {started ? (
          <div aria-live="polite">
            <p className="text-[15px] font-semibold">Waiting for the tourist to pay</p>
            <p className="mt-2 font-mono text-2xl font-bold tabular-nums">{ksh(total)}</p>
            <p className="mt-1 text-[13px] text-sawa-text-muted">
              {SALE.item}, {ksh(SALE.amount)} + {ksh(SALE.photo)} photo consent. Expires in 30 minutes.
            </p>
          </div>
        ) : (
          <div className="grid gap-3">
            <Filled label="Agreed amount (KSh)" value={SALE.amount} mono />
            <Filled label="Description (optional)" value={SALE.item} />
            <p className="flex items-center gap-2 text-[15px]">
              <span className="flex size-5 items-center justify-center rounded-[4px] bg-sawa-green text-white">
                <Check aria-hidden="true" className="size-4" />
              </span>
              Photo consent (+{ksh(SALE.photo)})
            </p>
            <SecondaryButton className="mt-1 w-full" onClick={() => setStarted(true)}>
              Start the sale
            </SecondaryButton>
          </div>
        )}
      </Card>
    </>
  )
}

function StallHeading() {
  return (
    <div>
      <p className="flex items-center gap-2 text-[13px] text-sawa-text-muted">
        <ScanLine aria-hidden="true" className="size-4" /> You scanned the stall's QR
      </p>
      <h1 className="mt-1 text-2xl font-semibold">{SALE.maker}</h1>
      <p className="text-[15px] text-sawa-text-muted">
        {SALE.site} · {SALE.item.toLowerCase()}
      </p>
    </div>
  )
}

// 5. The tourist scans the stall: "Still with James?", then the breakdown.
function ScanStall({ withGuide, answer, card }) {
  return (
    <>
      <StallHeading />
      {withGuide === null ? (
        <Card>
          <h2 className="text-lg font-semibold">Still with {GUIDE.name}?</h2>
          <p className="mt-1 text-[13px] text-sawa-text-muted">
            If {GUIDE.name} brought you here, he gets his disclosed share of this sale.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <SecondaryButton onClick={() => answer("yes")}>Yes, still with {GUIDE.name}</SecondaryButton>
            <SecondaryButton onClick={() => answer("no")}>No, not with {GUIDE.name}</SecondaryButton>
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
          <button type="button" onClick={() => answer(null)} className={`${linkButton} -mt-3`}>
            Change my answer
          </button>
        </>
      )}
    </>
  )
}

// 6. Pay by M-Pesa (simulated); how cash would work instead.
function Pay({ s, withGuide, onPaid }) {
  const [paying, setPaying] = useState(false)
  // "Pay" waits a moment, as the real M-Pesa prompt would, then shows the receipt.
  useEffect(() => {
    if (!paying) return undefined
    const timer = setTimeout(onPaid, 1800)
    return () => clearTimeout(timer)
  }, [paying, onPaid])
  return (
    <>
      <StallHeading />
      <Card className="bg-sawa-bg">
        <Row label={SALE.makerFirst} value={ksh(s.maker)} />
        {withGuide && <Row label={`${GUIDE.name} (guide referral)`} value={ksh(s.guide)} />}
        <Row label="Sawa Split" value={ksh(0)} />
        <div className="border-t border-sawa-border">
          <Row label="Total" value={ksh(s.total)} strong />
        </div>
      </Card>
      <PayButton busy={paying} onClick={() => setPaying(true)}>
        {paying ? "Waiting for the M-Pesa PIN…" : `Pay ${ksh(s.total)} by M-Pesa (demo)`}
      </PayButton>
      <p className="-mt-3 text-[13px] text-sawa-text-muted">
        In the real checkout an M-Pesa prompt opens on the tourist's phone. Here nothing is sent and nobody is charged.
      </p>
      <Card>
        <p className="flex items-center gap-2 text-sm font-semibold">
          <Banknote aria-hidden="true" className="size-4 text-sawa-green" /> Paying cash instead?
        </p>
        <p className="mt-2 text-[13px] text-sawa-text-muted">
          The tourist hands the cash to {SALE.makerFirst}. The sale counts only once two people confirm it on their phones
          within 10 minutes: {withGuide ? `${SALE.makerFirst} and ${GUIDE.name}` : `${SALE.makerFirst} and the tourist`}.
          Otherwise it expires and nothing is credited. Cash is never paid out again by M-Pesa:{" "}
          {SALE.makerFirst} already has it.
        </p>
      </Card>
    </>
  )
}

// 7. The receipt.
function Receipt({ s, card }) {
  return (
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
    </>
  )
}

// 8. Both dashboards, credited.
function Credited({ s }) {
  return (
    <>
      <h1 className="text-2xl font-semibold">Split credited</h1>
      <div className="grid gap-3">
        <Card>
          <p className="flex items-center gap-2 text-sm font-semibold">
            <Hand aria-hidden="true" className="size-4 text-sawa-green" /> {SALE.maker}'s dashboard
          </p>
          <p className="mt-2 font-mono text-3xl font-bold tabular-nums text-sawa-green">+{ksh(s.maker)}</p>
          <p className="text-[13px] text-sawa-text-muted">
            {ksh(s.product)} of the necklace + {ksh(SALE.photo)} photo consent
          </p>
        </Card>
        <Card>
          <p className="flex items-center gap-2 text-sm font-semibold">
            <Compass aria-hidden="true" className="size-4 text-sawa-green" /> {GUIDE.name}'s dashboard
          </p>
          {s.guide > 0 ? (
            <>
              <p className="mt-2 font-mono text-3xl font-bold tabular-nums text-sawa-green">+{ksh(s.guide)}</p>
              <p className="text-[13px] text-sawa-text-muted">His {SALE.pct}% referral, disclosed before the tourist paid</p>
            </>
          ) : (
            <p className="mt-2 text-[15px] text-sawa-text-muted">No referral on this sale: the tourist wasn't with him.</p>
          )}
        </Card>
      </div>
    </>
  )
}

// 9. Payouts: Wanjiru withdraws her full balance (simulated).
function Payouts({ s }) {
  const [state, setState] = useState("ready") // ready | sending | sent
  useEffect(() => {
    if (state !== "sending") return undefined
    const timer = setTimeout(() => setState("sent"), 1500)
    return () => clearTimeout(timer)
  }, [state])
  return (
    <>
      <div>
        <p className="text-[13px] text-sawa-text-muted">Wanjiru's dashboard</p>
        <h1 className="mt-1 text-2xl font-semibold">Balance</h1>
      </div>
      <Card>
        <p className="text-[13px] text-sawa-text-muted">Available to withdraw</p>
        <p className="mt-1 font-mono text-3xl font-bold tabular-nums">{ksh(state === "sent" ? 0 : s.maker)}</p>
        {state === "sent" ? (
          <div className="mt-4">
            <Done>{ksh(s.maker)} sent to Wanjiru's M-Pesa (simulated).</Done>
          </div>
        ) : (
          <>
            <p className="mt-1 text-[13px] text-sawa-text-muted">
              It's over {ksh(THRESHOLD)}, so she can withdraw it now, in full.
            </p>
            <SecondaryButton className="mt-4 w-full" disabled={state === "sending"} onClick={() => setState("sending")}>
              {state === "sending" ? "Sending to M-Pesa…" : `Withdraw ${ksh(s.maker)}`}
            </SecondaryButton>
          </>
        )}
      </Card>
      <p className="flex items-start gap-2 text-[13px] text-sawa-text-muted">
        <Wallet aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-sawa-green" />
        <span>
          Withdrawals are always the full balance, never part of it. Anyone at {ksh(THRESHOLD)} or more who hasn't
          withdrawn is paid automatically at 18:00.
          {s.guide > 0 && ` James's ${ksh(s.guide)} stays credited to him until his balance reaches ${ksh(THRESHOLD)}.`}
        </span>
      </p>
    </>
  )
}

// 10. The coordinator's reconciliation: collected = credited, no platform fee.
function Reconcile({ s }) {
  return (
    <>
      <div>
        <p className="text-[13px] text-sawa-text-muted">Coordinator · Reconciliation</p>
        <h1 className="mt-1 text-2xl font-semibold">Every shilling accounted for</h1>
      </div>
      <Card>
        <Row label="M-Pesa collected" value={ksh(s.total)} strong />
        <div className="border-t border-sawa-border">
          <Row label="Credited to Wanjiru" value={ksh(s.maker)} />
          {s.guide > 0 && <Row label="Credited to James" value={ksh(s.guide)} />}
          <Row label="Platform fee" value={ksh(0)} />
        </div>
        <div className="border-t border-sawa-border">
          <Row label="Paid out to M-Pesa" value={ksh(s.maker)} />
          <Row label="Still owed" value={ksh(s.guide)} />
        </div>
      </Card>
      <Done>Collected = credited = paid out + still owed.</Done>
      {s.guide > 0 && (
        <Card>
          <p className="text-sm font-semibold">Referrers</p>
          <Row label={`${GUIDE.code} · ${GUIDE.type} · 1 sale`} value={ksh(s.guide)} />
        </Card>
      )}
    </>
  )
}

// 11. Coming next: a static preview, not built.
function ComingNext() {
  const navigate = useNavigate()
  return (
    <>
      <Preview />
      <div className="-mt-3">
        <h1 className="text-2xl font-semibold">Coming next</h1>
        <p className="mt-1 text-[15px] text-sawa-text-muted">
          Find a verified guide near you, then check in with them in one scan.
        </p>
      </div>
      <div>
        <h2 className="text-base font-semibold">Verified guides at {SALE.site}</h2>
        <ul className="mt-3 flex flex-col gap-3">
          {NEARBY.map((g) => (
            <li key={g.name} className="rounded-sawa border border-sawa-border bg-sawa-surface p-4">
              <div className="text-[15px] font-semibold text-sawa-text">
                {g.name} · {g.type}
              </div>
              <div className="mt-1 inline-flex items-center gap-1 text-[13px] text-sawa-green">
                <BadgeCheck aria-hidden="true" className="size-4" /> Coordinator-verified
              </div>
            </li>
          ))}
        </ul>
      </div>
      <Card>
        <p className="flex items-center gap-2 text-sm font-semibold">
          <ScanLine aria-hidden="true" className="size-4 text-sawa-green" /> One-scan check-in
        </p>
        <p className="mt-2 text-[13px] text-sawa-text-muted">
          The group scans their chosen guide's QR once at the start of the day; every stall after that knows who brought
          them. Still no account and no app.
        </p>
      </Card>
      <div className="border-t border-sawa-border pt-3">
        <button
          type="button"
          onClick={() => navigate("/", { state: { scrollTo: "contact" } })}
          className={`${tapTarget} text-left text-[15px] font-semibold text-sawa-green underline-offset-2 hover:underline`}
        >
          Try it with your own team: contact us
        </button>
      </div>
    </>
  )
}

function Explain({ text, className = "" }) {
  return (
    <aside aria-label="What's happening" className={`rounded-sawa bg-[#1B2A41] p-5 ${className}`}>
      <h2 className="font-mono text-xs font-semibold uppercase tracking-wide text-white/85">What's happening</h2>
      <p className="mt-2 text-[15px] leading-relaxed text-white lg:mt-3 lg:text-xl lg:font-medium">{text}</p>
    </aside>
  )
}

const navButton =
  "inline-flex min-h-11 items-center gap-2 rounded-sawa border border-white px-4 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:cursor-not-allowed disabled:opacity-40"

export default function DemoPage() {
  // The step and the tourist's answer live in the URL: ?step=1..11 opens a step directly
  // (for links and screenshots), and ?guide=no follows the path without James. From the
  // payment on, an unanswered "Still with James?" counts as Yes.
  const [search, setSearch] = useSearchParams()
  const step = Math.min(Math.max(Number.parseInt(search.get("step"), 10) || 1, 1), LAST)
  const answered = search.get("guide") === "yes" ? true : search.get("guide") === "no" ? false : null
  const withGuide = answered === null && step >= 6 ? true : answered
  const s = split(withGuide !== false)

  function go(n, guide = search.get("guide")) {
    const next = new URLSearchParams()
    next.set("step", String(n))
    if (guide) next.set("guide", guide)
    setSearch(next, { replace: true })
    window.scrollTo({ top: 0 })
  }
  const answer = (g) => {
    const next = new URLSearchParams(search)
    if (g) next.set("guide", g)
    else next.delete("guide")
    setSearch(next, { replace: true })
  }
  const restart = () => go(1, null)
  // Next waits on step 5 until "Still with James?" is answered.
  const blocked = step === 5 && answered === null

  const card = cardProps({
    site: SALE.site,
    producerName: SALE.makerFirst,
    driverName: withGuide ? GUIDE.name : null,
    product: { amount: SALE.amount, maker_amount: s.product, driver_amount: s.guide },
    photo: { amount: SALE.photo },
    total: s.total,
  })

  const { screen, explain } = STEPS[step - 1]
  const text = explain(s, answered)
  const ScreenIcon = screen?.icon

  return (
    <div style={BRAND_BACKGROUND} className="flex min-h-screen flex-col">
      <div role="note" className="sticky top-[57px] z-10 bg-sawa-text px-4 py-2 text-center text-sm font-semibold text-white">
        Demo — no real payment is made
      </div>
      <div className="mx-auto w-full max-w-[1000px] flex-1 px-4 py-6 lg:px-8 lg:py-10">
        <Progress step={step} go={go} />
        <Explain text={text} className="mt-5 lg:hidden" />
        <div className="mt-5 grid items-start gap-8 lg:mt-8 lg:grid-cols-[420px_1fr] lg:gap-14">
          <div>
            {screen && (
              <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-white">
                <ScreenIcon aria-hidden="true" className="size-4" /> {screen.label}
              </p>
            )}
            {!screen && (
              <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-white">
                <Smartphone aria-hidden="true" className="size-4" /> Wanjiru's and James's phones
              </p>
            )}
            <main className="flex flex-col gap-6 rounded-[24px] bg-white p-6 shadow-[0_12px_40px_rgba(0,0,0,0.25)] lg:p-8">
              {step === 1 && <Register />}
              {step === 2 && <StartTour />}
              {step === 3 && <TourPass />}
              {step === 4 && <NewSale />}
              {step === 5 && <ScanStall withGuide={answered} answer={answer} card={card} />}
              {step === 6 && <Pay s={s} withGuide={withGuide} onPaid={() => go(7, withGuide ? "yes" : "no")} />}
              {step === 7 && <Receipt s={s} card={card} />}
              {step === 8 && <Credited s={s} />}
              {step === 9 && <Payouts s={s} />}
              {step === 10 && <Reconcile s={s} />}
              {step === 11 && <ComingNext />}
            </main>
          </div>
          <Explain text={text} className="hidden lg:mt-7 lg:block" />
        </div>
      </div>

      {/* Back and Next: always in reach, on a solid navy bar (the page's teal end is too
          light behind white text). */}
      <div className="sticky bottom-0 z-10 border-t border-white/15 bg-[#1B2A41]">
        <div className="mx-auto flex max-w-[1000px] items-center justify-between gap-3 px-4 py-2 lg:px-8">
          <button type="button" onClick={() => go(step - 1)} disabled={step === 1} className={`${navButton} text-white hover:bg-white/10`}>
            <ArrowLeft aria-hidden="true" className="size-4" /> Back
          </button>
          <span className="text-sm text-white/85">
            {blocked ? (
              "Answer above to go on"
            ) : (
              <>
                Step <span className="font-mono tabular-nums">{step}</span> of <span className="font-mono tabular-nums">{LAST}</span>
              </>
            )}
          </span>
          {step < LAST ? (
            <button type="button" onClick={() => go(step + 1)} disabled={blocked} className={`${navButton} bg-white text-[#1B2A41] hover:bg-white/90`}>
              Next <ArrowRight aria-hidden="true" className="size-4" />
            </button>
          ) : (
            <button type="button" onClick={restart} className={`${navButton} bg-white text-[#1B2A41] hover:bg-white/90`}>
              Start again
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
