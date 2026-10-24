import { useEffect, useReducer, useRef, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Banknote,
  Check,
  Clock,
  Compass,
  Hand,
  Landmark,
  Laptop,
  Leaf,
  Minus,
  Plus,
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
import { THRESHOLD, emptyLedger, owed, payable, record, sweep, totals, withdraw } from "../lib/demoLedger"
import { FUND_PCT, INTERMEDIARY_PCT, split } from "../lib/demoSplit"
import { ksh } from "../lib/format"

// An interactive walkthrough: judges register people, start a tour, set the price, pay
// by M-Pesa or cash, and watch the money land, settle, pay out and reconcile. Everything
// lives in this page's memory: it calls no API and writes no storage, and a reload starts
// over. The split and the ledger follow the live rules (lib/demoSplit.js, lib/demoLedger.js;
// tested by scripts/test-demo-split.mjs): 1000 -> 800 / 150 / 50, Sawa Split keeps nothing.
const FUND = "Conservation & sustainability fund"
const PHOTO_FEE = 10
const MIN_PRICE = 50
const MAX_PRICE = 5000
const UNLOCK = `Withdraw unlocks at ${ksh(THRESHOLD)}. Every evening at 18:00, everyone at ${ksh(THRESHOLD)} or more is paid automatically.`

const initial = () => ({
  creator: "Mashujaa Dancers",
  service: "Cultural dance performance",
  inter: "Abdi-Majid",
  interType: "Tour guide",
  site: "Talek gate",
  registered: false,
  group: 5,
  tourStarted: false,
  joined: false,
  price: 1000,
  product: false, // a service by default: photography included, no photo line
  photo: true, // the optional photo fee, offered when it's a product
  saleOpen: false,
  answer: null, // "Still with <intermediary>?": true / false
  paidId: null, // this round's sale, once paid
  sales: [],
  ledger: emptyLedger(),
  notice: null, // what the last Withdraw / sweep did
})

// "Mashujaa Dancers' phone", "Abdi-Majid's phone".
const poss = (name) => (/s$/i.test(name.trim()) ? `${name}'` : `${name}'s`)

const photoFeeOf = (st) => (st.product && st.photo ? PHOTO_FEE : 0)
const draftSplit = (st) => split({ price: st.price, photoFee: photoFeeOf(st), withIntermediary: st.answer !== false })
const validPrice = (p) => Number.isInteger(p) && p >= MIN_PRICE && p <= MAX_PRICE

function pay(st, method) {
  if (st.paidId) return st
  const id = st.sales.length + 1
  const sale = { id, method, price: st.price, photoFee: photoFeeOf(st), withIntermediary: st.answer !== false, product: st.product, split: draftSplit(st) }
  return { ...st, paidId: id, sales: [...st.sales, sale], ledger: record(st.ledger, sale), notice: null }
}

function reducer(st, a) {
  switch (a.type) {
    case "set":
      return { ...st, ...a.patch }
    case "register":
      return { ...st, registered: true }
    case "startTour":
      return { ...st, tourStarted: true }
    case "join":
      return { ...st, joined: true }
    case "openSale":
      return validPrice(st.price) ? { ...st, saleOpen: true } : st
    case "answer":
      return st.paidId ? st : { ...st, answer: a.value }
    case "pay":
      return pay(st, a.method)
    case "withdraw": {
      const before = st.ledger.payouts.length
      const ledger = withdraw(st.ledger, a.who)
      return { ...st, ledger, notice: ledger.payouts.length > before ? { kind: "withdraw", from: before } : st.notice }
    }
    case "sweep": {
      const before = st.ledger.payouts.length
      return { ...st, ledger: sweep(st.ledger), notice: { kind: "sweep", from: before } }
    }
    case "another":
      return { ...st, saleOpen: false, answer: null, paidId: null, notice: null }
    case "reset":
      return initial()
    // Opening a step directly (?step=N, or Next past an undone step) does the steps
    // before it with the defaults, so every step can be shown on its own.
    case "ensure": {
      let s = st
      if (a.step > 1) s = { ...s, registered: true }
      if (a.step > 2) s = { ...s, tourStarted: true }
      if (a.step > 3) s = { ...s, joined: true }
      if (a.step > 4 && !s.saleOpen) s = { ...s, saleOpen: true, price: validPrice(s.price) ? s.price : 1000 }
      if (a.step > 5 && s.answer === null) s = { ...s, answer: true }
      if (a.step > 6 && !s.paidId) s = pay(s, "mpesa")
      return s
    }
    default:
      return st
  }
}

// Whose screen each step shows.
const screens = (st) => ({
  coordinator: { label: "Coordinator's laptop", icon: Laptop },
  inter: { label: `${poss(st.inter)} phone`, icon: Compass },
  tourist: { label: "Tourist's phone", icon: Smartphone },
  creator: { label: `${poss(st.creator)} phone`, icon: Hand },
  dashboards: { label: "Everyone's dashboards", icon: Users },
})

// Each step: its progress label, whose screen, and "What's happening" beside it.
const STEPS = [
  {
    label: "Register",
    screen: "coordinator",
    explain: (st) =>
      `A coordinator registers every creator and site intermediary in person; there's no public sign-up. Here: ${st.creator} and ${st.inter}. Change the names if you like, then Register. Every sale splits the same fixed way: 80% creator · 15% site intermediary · 5% ${FUND.toLowerCase()}. Sawa Split keeps nothing.`,
  },
  {
    label: "Start tour",
    screen: "inter",
    explain: (st) =>
      `${st.inter} starts today's tour and says how many tourists are with them. Only tourists who join a running tour earn ${st.inter} a share, and only up to that number: a phone past ${st.group} is refused.`,
  },
  {
    label: "Tour pass",
    screen: "tourist",
    explain: (st) =>
      `The tourist scans ${poss(st.inter)} QR card. The phone keeps a tour pass until midnight, so every stall they visit knows who brought them. No account, no app to install.`,
  },
  {
    label: "New sale",
    screen: "creator",
    explain: (st) =>
      `${st.creator} agrees the price with the tourist and types it in (KSh ${MIN_PRICE} to ${MAX_PRICE.toLocaleString("en-KE")} here). A service includes photography; a product can add photo consent (+${ksh(PHOTO_FEE)}), which always goes to the creator in full. The sale is single-use and expires after 30 minutes.`,
  },
  {
    label: "Scan stall",
    screen: "tourist",
    explain: (st, s) =>
      st.answer === null
        ? `The tourist scans the QR on ${poss(st.creator)} stand. First the checkout asks: still with ${st.inter}? Yes gives ${st.inter} the disclosed 15%; No means no share for anyone but the creator and the fund.`
        : `The server works out every share before anyone pays, rounded down to whole shillings: ${st.creator} ${ksh(s.creator)}, ${
            s.intermediary ? `${st.inter} ${ksh(s.intermediary)}, ` : ""
          }the ${FUND.toLowerCase()} ${ksh(s.fund)}. Switch Yes / No to see it change.`,
  },
  {
    label: "Pay",
    screen: "tourist",
    explain: (st) =>
      `M-Pesa: the tourist confirms on their own phone and Safaricom tells Sawa Split. Cash: the tourist hands the cash to ${st.creator}, and the sale counts only once two people confirm it: ${
        st.answer === false ? `the tourist and ${st.creator}` : `${st.inter} and ${st.creator}`
      }.`,
  },
  {
    label: "Receipt",
    screen: "tourist",
    explain: () => "The receipt shows the same lines the tourist saw before paying. Nothing was taken out for Sawa Split.",
  },
  {
    label: "Dashboards",
    screen: "dashboards",
    explain: (st) => {
      const sale = st.sales.find((x) => x.id === st.paidId)
      return sale?.method === "cash"
        ? `Cash stays with ${st.creator}, so it's recorded, never paid out again. What ${st.creator} owes from it (15% to ${st.inter}, 5% to the fund) is paid from their next M-Pesa earnings, each debt whole, automatically.`
        : `The moment Safaricom confirms, every share is credited to its owner. Each entry is written once and never edited.`
    },
  },
  {
    label: "Payouts",
    screen: "dashboards",
    explain: () =>
      `Balances go to M-Pesa in full, never in part, from ${ksh(THRESHOLD)}: on request, or at the 18:00 sweep, which first settles cash debts. The fund is ring-fenced: never paid out by the payout engine.`,
  },
  {
    label: "Reconcile",
    screen: "coordinator",
    explain: () =>
      `The coordinator sees every shilling of every sale this session. What M-Pesa collected equals what creators, site intermediaries and the fund were credited, and equals paid out plus still owed. Cash is shown beside it, never in it. Sawa Split: KSh 0.`,
  },
  {
    label: "Coming next",
    screen: "tourist",
    explain: () => "Next on the roadmap. Shown as a preview; none of it is built yet.",
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

function Row({ label, value, strong = false, mono = true }) {
  return (
    <div className={`flex items-baseline justify-between gap-4 py-2 text-[15px] ${strong ? "font-semibold" : ""}`}>
      <span>{label}</span>
      <span className={`whitespace-nowrap ${mono ? "font-mono tabular-nums" : ""}`}>{value}</span>
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

function Note({ children, className = "" }) {
  return <p className={`text-[13px] text-sawa-text-muted ${className}`}>{children}</p>
}

function Verified() {
  return (
    <span className="inline-flex items-center gap-1 text-[13px] font-semibold text-sawa-green">
      <BadgeCheck aria-hidden="true" className="size-4" /> Coordinator-verified
    </span>
  )
}

function Heading({ who, title }) {
  return (
    <div>
      {who && <p className="text-[13px] text-sawa-text-muted">{who}</p>}
      <h1 className="mt-1 text-2xl font-semibold">{title}</h1>
    </div>
  )
}

function TextInput({ id, label, value, onChange, disabled }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] text-sawa-text-muted">
        {label}
      </label>
      <input
        id={id}
        value={value}
        disabled={disabled}
        maxLength={40}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-11 rounded-sawa border border-sawa-border bg-sawa-surface px-3 py-2.5 text-[15px] text-sawa-text outline-none focus:border-2 focus:border-sawa-green disabled:bg-sawa-bg"
      />
    </div>
  )
}

// A balance that counts up from 0 when it appears, then to each new value; instant with
// reduced motion.
function CountUp({ value, className = "" }) {
  const [shown, setShown] = useState(0)
  const from = useRef(0)
  useEffect(() => {
    const start = from.current
    from.current = value
    if (start === value || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setShown(value)
      return undefined
    }
    let frame
    const t0 = performance.now()
    const tick = (t) => {
      const k = Math.min((t - t0) / 900, 1)
      setShown(Math.round(start + (value - start) * (1 - (1 - k) ** 3)))
      if (k < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [value])
  return <span className={`font-mono tabular-nums ${className}`}>{ksh(shown)}</span>
}

const primaryButton =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-sawa border border-sawa-green bg-sawa-green px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#174a2f] disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sawa-green"

// 1. The coordinator registers the creator and the site intermediary.
function Register({ st, set, dispatch }) {
  const locked = st.registered
  return (
    <>
      <Heading who="Coordinator · Register" title="Register a creator and a site intermediary" />
      <Card>
        <p className="flex items-center gap-2 text-sm font-semibold">
          <Hand aria-hidden="true" className="size-4 text-sawa-green" /> Creator
        </p>
        <div className="mt-3 grid gap-3">
          <TextInput id="d-creator" label="Name" value={st.creator} disabled={locked} onChange={(v) => set({ creator: v })} />
          <TextInput id="d-service" label="What they offer" value={st.service} disabled={locked} onChange={(v) => set({ service: v })} />
          <TextInput id="d-site" label="Site" value={st.site} disabled={locked} onChange={(v) => set({ site: v })} />
        </div>
        <Note className="mt-3">Fixed split: 80% creator · 15% site intermediary · 5% fund.</Note>
        {locked && <div className="mt-3"><Verified /></div>}
      </Card>
      <Card>
        <p className="flex items-center gap-2 text-sm font-semibold">
          <Compass aria-hidden="true" className="size-4 text-sawa-green" /> Site intermediary
        </p>
        <div className="mt-3 grid gap-3">
          <TextInput id="d-inter" label="Name" value={st.inter} disabled={locked} onChange={(v) => set({ inter: v })} />
          <TextInput id="d-type" label="Type" value={st.interType} disabled={locked} onChange={(v) => set({ interType: v })} />
        </div>
        {locked && <div className="mt-3"><Verified /></div>}
      </Card>
      {locked ? (
        <Done>Both registered in person, each with a 4-digit PIN.</Done>
      ) : (
        <button type="button" className={primaryButton} disabled={!st.creator.trim() || !st.inter.trim()} onClick={() => dispatch({ type: "register" })}>
          Register
        </button>
      )}
    </>
  )
}

// 2. The site intermediary starts today's tour.
function StartTour({ st, set, dispatch }) {
  const change = (d) => set({ group: Math.min(30, Math.max(1, st.group + d)) })
  return (
    <>
      <Heading who={`${poss(st.inter)} dashboard`} title="Today's tour" />
      <Card>
        {st.tourStarted ? (
          <div aria-live="polite">
            <p className="flex items-center gap-2 text-[15px] font-semibold text-sawa-green">
              <Users aria-hidden="true" className="size-5" /> Tour running
            </p>
            <p className="mt-2 font-mono text-2xl font-bold tabular-nums">
              {st.joined ? 1 : 0} of {st.group} joined
            </p>
            <Note className="mt-1">Ends at midnight, or when {st.inter} taps End tour.</Note>
          </div>
        ) : (
          <>
            <p id="d-group-label" className="text-[15px]">How many tourists are with you today?</p>
            <div role="group" aria-labelledby="d-group-label" className="mt-3 flex items-center gap-3">
              <SecondaryButton aria-label="One fewer" disabled={st.group <= 1} onClick={() => change(-1)} className="w-11 px-0">
                <Minus aria-hidden="true" className="size-4" />
              </SecondaryButton>
              <output aria-live="polite" className="w-12 text-center font-mono text-2xl font-bold tabular-nums">
                {st.group}
              </output>
              <SecondaryButton aria-label="One more" disabled={st.group >= 30} onClick={() => change(1)} className="w-11 px-0">
                <Plus aria-hidden="true" className="size-4" />
              </SecondaryButton>
            </div>
            <button type="button" className={`${primaryButton} mt-5 w-full`} onClick={() => dispatch({ type: "startTour" })}>
              Start tour
            </button>
          </>
        )}
      </Card>
    </>
  )
}

// 3. The tourist scans the site intermediary's QR: a tour pass for today.
function TourPass({ st, dispatch }) {
  const [scanning, setScanning] = useState(false)
  useEffect(() => {
    if (!scanning) return undefined
    const t = setTimeout(() => {
      setScanning(false)
      dispatch({ type: "join" })
    }, 1400)
    return () => clearTimeout(t)
  }, [scanning, dispatch])
  if (st.joined)
    return (
      <Card>
        <p className="flex items-center gap-2 text-[13px] text-sawa-text-muted">
          <QrCode aria-hidden="true" className="size-4" /> Tour pass · until midnight
        </p>
        <h1 className="mt-1 text-xl font-semibold">
          {st.inter} · site intermediary · {st.interType.toLowerCase()}
        </h1>
        <div className="mt-2">
          <Verified />
        </div>
        <div className="mt-4">
          <Done>{st.inter} is your site intermediary today.</Done>
        </div>
        <Note className="mt-2">
          {poss(st.inter)} tour: 1 of {st.group} joined. (In this demo nothing is saved on the phone.)
        </Note>
      </Card>
    )
  return (
    <>
      <Heading who="Tourist's camera" title={`Scan ${poss(st.inter)} card`} />
      <div aria-hidden="true" className="relative mx-auto flex size-48 items-center justify-center overflow-hidden rounded-sawa border-2 border-sawa-text bg-sawa-bg">
        <QrCode className="size-28 text-sawa-text" strokeWidth={1.25} />
        {scanning && <span className="demo-scan-line absolute inset-x-2 h-0.5 bg-sawa-green" />}
      </div>
      <style>{`.demo-scan-line{animation:demo-scan 1.4s ease-in-out}@keyframes demo-scan{0%{top:8%}50%{top:88%}100%{top:8%}}@media (prefers-reduced-motion:reduce){.demo-scan-line{animation:none;top:50%}}`}</style>
      <p aria-live="polite" className="text-center text-[15px] text-sawa-text-muted">
        {scanning ? "Scanning…" : `${st.inter} hands the tourist their QR card.`}
      </p>
      <button type="button" className={primaryButton} disabled={scanning} onClick={() => setScanning(true)}>
        <ScanLine aria-hidden="true" className="size-4" /> Scan {poss(st.inter)} QR
      </button>
    </>
  )
}

// 4. The creator enters the agreed price.
function NewSale({ st, set, dispatch }) {
  const s = draftSplit(st)
  const ok = validPrice(st.price)
  if (st.saleOpen)
    return (
      <>
        <Heading who={`${poss(st.creator)} dashboard`} title="New sale" />
        <Card>
          <div aria-live="polite">
            <p className="text-[15px] font-semibold">Waiting for the tourist to pay</p>
            <p className="mt-2 font-mono text-2xl font-bold tabular-nums">{ksh(s.total)}</p>
            <Note className="mt-1">
              {st.product ? "Product" : `${st.service} (photography included)`}, {ksh(st.price)}
              {s.photoFee ? ` + ${ksh(s.photoFee)} photo consent` : ""}. Expires in 30 minutes.
            </Note>
          </div>
        </Card>
      </>
    )
  return (
    <>
      <Heading who={`${poss(st.creator)} dashboard`} title="New sale" />
      <Card>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="d-price" className="text-[13px] text-sawa-text-muted">
            Agreed price (KSh)
          </label>
          <input
            id="d-price"
            type="number"
            inputMode="numeric"
            min={MIN_PRICE}
            max={MAX_PRICE}
            step={1}
            value={Number.isNaN(st.price) ? "" : st.price}
            onChange={(e) => set({ price: e.target.value === "" ? Number.NaN : Number(e.target.value) })}
            aria-invalid={ok ? undefined : "true"}
            aria-describedby="d-price-note"
            className={`min-h-11 rounded-sawa border bg-sawa-surface px-3 py-2.5 font-mono text-[15px] outline-none focus:border-2 focus:border-sawa-green ${ok ? "border-sawa-border" : "border-sawa-terracotta"}`}
          />
          <input
            type="range"
            aria-label="Agreed price, slider"
            min={MIN_PRICE}
            max={MAX_PRICE}
            step={10}
            value={ok ? st.price : MIN_PRICE}
            onChange={(e) => set({ price: Number(e.target.value) })}
            className="mt-2 h-11 w-full accent-[#1E5B3A]"
          />
          <p id="d-price-note" className={`text-xs ${ok ? "text-sawa-text-muted" : "text-sawa-terracotta"}`}>
            {ok ? `Whole shillings, KSh ${MIN_PRICE}–${MAX_PRICE.toLocaleString("en-KE")}.` : `Enter whole shillings from ${MIN_PRICE} to ${MAX_PRICE.toLocaleString("en-KE")}.`}
          </p>
        </div>
        <label className="mt-4 flex min-h-11 cursor-pointer items-center gap-3 text-[15px]">
          <input type="checkbox" checked={st.product} onChange={(e) => set({ product: e.target.checked })} className="size-5 accent-[#1E5B3A]" />
          Product instead of service
        </label>
        {st.product ? (
          <label className="flex min-h-11 cursor-pointer items-center gap-3 pl-8 text-[15px]">
            <input type="checkbox" checked={st.photo} onChange={(e) => set({ photo: e.target.checked })} className="size-5 accent-[#1E5B3A]" />
            Photo consent (+{ksh(PHOTO_FEE)}), to the creator in full
          </label>
        ) : (
          <Note>A service: {st.service.toLowerCase()}, photography included.</Note>
        )}
        <button type="button" className={`${primaryButton} mt-4 w-full`} disabled={!ok} onClick={() => dispatch({ type: "openSale" })}>
          Start the sale · {ok ? ksh(s.total) : "—"}
        </button>
      </Card>
    </>
  )
}

function card(st, s) {
  return cardProps({
    site: st.site,
    producerName: st.creator,
    driverName: s.intermediary ? st.inter : null,
    product: { amount: s.price, maker_amount: s.creatorProduct, driver_amount: s.intermediary, fund_amount: s.fund },
    photo: s.photoFee ? { amount: s.photoFee } : null,
    total: s.total,
    service: !st.product,
  })
}

function StallHeading({ st }) {
  return (
    <div>
      <p className="flex items-center gap-2 text-[13px] text-sawa-text-muted">
        <ScanLine aria-hidden="true" className="size-4" /> You scanned the stall's QR
      </p>
      <h1 className="mt-1 text-2xl font-semibold">{st.creator}</h1>
      <p className="text-[15px] text-sawa-text-muted">
        {st.site} · {st.product ? "product" : st.service.toLowerCase()}
      </p>
      <div className="mt-1">
        <Verified />
      </div>
    </div>
  )
}

function Choice({ pressed, onClick, children, disabled }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-sawa border px-3 py-2 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sawa-green disabled:cursor-not-allowed ${
        pressed ? "border-sawa-green bg-sawa-green text-white" : "border-sawa-green text-sawa-green hover:bg-sawa-green/10"
      }`}
    >
      {pressed && <Check aria-hidden="true" className="size-4" />}
      {children}
    </button>
  )
}

// 5. The tourist scans the stall: "Still with ...?" and the live breakdown.
function ScanStall({ st, dispatch }) {
  const s = draftSplit(st)
  return (
    <>
      <StallHeading st={st} />
      <Card>
        <h2 className="text-lg font-semibold">Still with {st.inter}?</h2>
        <Note className="mt-1">If {st.inter} brought you here, they get their disclosed 15% of this sale.</Note>
        <div className="mt-4 flex gap-3">
          <Choice pressed={st.answer === true} disabled={!!st.paidId} onClick={() => dispatch({ type: "answer", value: true })}>
            Yes
          </Choice>
          <Choice pressed={st.answer === false} disabled={!!st.paidId} onClick={() => dispatch({ type: "answer", value: false })}>
            No
          </Choice>
        </div>
      </Card>
      {st.answer !== null && (
        <div aria-live="polite" className="flex flex-col gap-3">
          <PriceTransparencyCard {...card(st, s)} />
          <Note>
            {s.intermediary ? `${poss(st.inter)} share is the fixed ${INTERMEDIARY_PCT}%, ` : `No site intermediary: ${st.creator} gets 95%, `}
            the fund {FUND_PCT}%, each rounded down to whole shillings. Sawa Split keeps nothing.
          </Note>
        </div>
      )}
    </>
  )
}

// 6. Pay: M-Pesa (simulated confirm on the phone, never a PIN field) or cash (two confirmations).
function Pay({ st, dispatch, onPaid }) {
  const s = draftSplit(st)
  const [method, setMethod] = useState(null)
  const [stage, setStage] = useState(0) // M-Pesa: 0 choose, 1 prompt, 2 confirming. Cash: 0, 1 first confirmed.
  const paid = useRef(onPaid)
  useEffect(() => {
    paid.current = onPaid
  })
  useEffect(() => {
    if (method !== "mpesa" || stage !== 2) return undefined
    const t = setTimeout(() => {
      dispatch({ type: "pay", method: "mpesa" })
      paid.current()
    }, 1400)
    return () => clearTimeout(t)
  }, [method, stage, dispatch])
  const sale = st.sales.find((x) => x.id === st.paidId)
  if (sale)
    return (
      <>
        <StallHeading st={st} />
        <Done>Paid by {sale.method === "mpesa" ? "M-Pesa" : "cash"}: {ksh(sale.split.total)}. Next: the receipt.</Done>
      </>
    )
  const first = s.intermediary ? { who: `${poss(st.inter)} phone`, text: `Confirm the cash sale. You earn ${ksh(s.intermediary)}.`, button: `Confirm as ${st.inter}` } : { who: "Tourist's phone", text: `Confirm you paid ${ksh(s.total)} in cash.`, button: "Confirm as the tourist" }
  return (
    <>
      <StallHeading st={st} />
      <Card className="bg-sawa-bg">
        <Row label={`Creator · ${st.creator}`} value={ksh(s.creator)} />
        {s.intermediary > 0 && <Row label={`Intermediary · ${st.inter}`} value={ksh(s.intermediary)} />}
        <Row label={`${FUND} (${FUND_PCT}%)`} value={ksh(s.fund)} />
        <Row label="Sawa Split" value={ksh(0)} />
        <div className="border-t border-sawa-border">
          <Row label="Total" value={ksh(s.total)} strong />
        </div>
      </Card>
      <div role="group" aria-label="How the tourist pays" className="flex gap-3">
        <Choice pressed={method === "mpesa"} disabled={stage > 0} onClick={() => setMethod("mpesa")}>
          <Smartphone aria-hidden="true" className="size-4" /> M-Pesa
        </Choice>
        <Choice pressed={method === "cash"} disabled={stage > 0} onClick={() => setMethod("cash")}>
          <Banknote aria-hidden="true" className="size-4" /> Cash
        </Choice>
      </div>
      {method === "mpesa" && stage === 0 && (
        <PayButton onClick={() => setStage(1)}>Pay {ksh(s.total)} by M-Pesa (demo)</PayButton>
      )}
      {method === "mpesa" && stage >= 1 && (
        <Card>
          <p aria-live="polite" className="flex items-center gap-2 text-[13px] text-sawa-text-muted">
            <Smartphone aria-hidden="true" className="size-4" /> On the tourist's phone (simulated)
          </p>
          <p className="mt-2 text-[15px]">
            Pay <span className="font-mono font-semibold tabular-nums">{ksh(s.total)}</span> to Sawa Split for {st.creator}?
          </p>
          <SecondaryButton className="mt-4 w-full" disabled={stage === 2} onClick={() => setStage(2)}>
            {stage === 2 ? "Waiting for Safaricom…" : "Confirm on phone"}
          </SecondaryButton>
          <Note className="mt-2">The real prompt asks for the M-Pesa PIN on the tourist's own phone. This demo never asks for one and sends nothing.</Note>
        </Card>
      )}
      {method === "cash" && (
        <div aria-live="polite" className="flex flex-col gap-3">
          <Card>
            <p className="text-[13px] text-sawa-text-muted">{first.who}</p>
            <p className="mt-1 text-[15px] font-semibold">{first.text}</p>
            {stage === 0 ? (
              <SecondaryButton className="mt-3 w-full" onClick={() => setStage(1)}>
                {first.button}
              </SecondaryButton>
            ) : (
              <div className="mt-3">
                <Done>Confirmed.</Done>
              </div>
            )}
          </Card>
          <Card className={stage === 0 ? "opacity-60" : ""}>
            <p className="text-[13px] text-sawa-text-muted">{poss(st.creator)} phone</p>
            <p className="mt-1 text-[15px] font-semibold">Confirm you received {ksh(s.total)} in cash.</p>
            <SecondaryButton
              className="mt-3 w-full"
              disabled={stage === 0}
              onClick={() => {
                dispatch({ type: "pay", method: "cash" })
                onPaid()
              }}
            >
              Confirm as {st.creator}
            </SecondaryButton>
          </Card>
          <Note>Both must confirm within 10 minutes, or the sale expires and nothing is recorded.</Note>
        </div>
      )}
    </>
  )
}

// 7. The receipt, every line.
function Receipt({ st }) {
  const sale = st.sales.find((x) => x.id === st.paidId)
  if (!sale) return null
  const s = sale.split
  return (
    <>
      <section aria-live="polite" className="flex items-center gap-5">
        <VerifiedStamp amount={s.total} at={new Date().toISOString()} place={st.site} />
        <div>
          <StatusBadge status={sale.method === "mpesa" ? "confirmed" : "cash_confirmed"} />
          <h1 className="mt-2 text-2xl font-semibold">{sale.method === "mpesa" ? "Payment confirmed" : "Cash sale confirmed"}</h1>
          <p className="mt-1 text-[15px] text-sawa-text-muted">The split is recorded.</p>
        </div>
      </section>
      <PriceTransparencyCard {...card({ ...st, product: sale.product }, s)} />
      <div className="flex flex-col gap-1 text-[13px] text-sawa-text-muted">
        <p>
          Receipt <span className="font-mono text-sawa-text">SS-DEMO{String(sale.id).padStart(4, "0")}</span> (sample)
        </p>
        <p>
          {sale.method === "cash"
            ? `The cash stays with ${st.creator}; it's never paid out again by M-Pesa.`
            : "Paid by M-Pesa."}{" "}
          Nothing was taken out for Sawa Split.
        </p>
      </div>
    </>
  )
}

function DebtList({ st, filter }) {
  const debts = st.ledger.debts.filter(filter)
  if (!debts.length) return null
  return (
    <ul className="mt-3 flex flex-col gap-2">
      {debts.map((d) => (
        <li key={d.id} className="flex items-start justify-between gap-3 text-[13px]">
          <span>
            Sale {d.saleId} (cash): {d.creditor === "fund" ? `5% to the fund` : `15% to ${st.inter}`}
          </span>
          <span className={`whitespace-nowrap font-mono tabular-nums ${d.settled ? "text-sawa-green" : "text-sawa-text"}`}>
            {ksh(d.amount)} · {d.settled ? "settled" : "owed"}
          </span>
        </li>
      ))}
    </ul>
  )
}

// 8. Dashboards: balances count up; cash debts and how they settle.
function Dashboards({ st, dispatch, go }) {
  const l = st.ledger
  const outstanding = owed(l)
  return (
    <>
      <Heading title="Dashboards" />
      <Card>
        <p className="flex items-center gap-2 text-sm font-semibold">
          <Hand aria-hidden="true" className="size-4 text-sawa-green" /> {st.creator}
        </p>
        <p className="mt-3 text-[13px] text-sawa-text-muted">M-Pesa balance</p>
        <CountUp value={l.available.creator} className="text-3xl font-bold text-sawa-green" />
        {l.cashHeld > 0 && (
          <p className="mt-2 text-[13px] text-sawa-text-muted">
            Cash received (kept, never paid out again): <CountUp value={l.cashHeld} className="text-sawa-text" />
          </p>
        )}
        {l.debts.length > 0 && (
          <>
            <p className="mt-3 text-sm font-semibold">From cash sales, owed: {ksh(outstanding)}</p>
            <DebtList st={st} filter={() => true} />
            <Note className="mt-2">
              Paid automatically from {poss(st.creator)} M-Pesa earnings: each debt whole, as soon as the balance covers it.
            </Note>
          </>
        )}
      </Card>
      <Card>
        <p className="flex items-center gap-2 text-sm font-semibold">
          <Compass aria-hidden="true" className="size-4 text-sawa-green" /> {st.inter}
        </p>
        <p className="mt-3 text-[13px] text-sawa-text-muted">M-Pesa balance</p>
        <CountUp value={l.available.intermediary} className="text-3xl font-bold text-sawa-green" />
        {l.debts.some((d) => d.creditor === "intermediary" && !d.settled) && (
          <Note className="mt-1">
            Plus {ksh(l.debts.filter((d) => d.creditor === "intermediary" && !d.settled).reduce((a, d) => a + d.amount, 0))} owed by{" "}
            {st.creator} from cash, on its way.
          </Note>
        )}
      </Card>
      <Card>
        <p className="flex items-center gap-2 text-sm font-semibold">
          <Leaf aria-hidden="true" className="size-4 text-sawa-green" /> {FUND}
        </p>
        <p className="mt-3 text-[13px] text-sawa-text-muted">Held</p>
        <CountUp value={l.available.fund} className="text-3xl font-bold text-sawa-green" />
        <Note className="mt-1">Ring-fenced — never paid out by the engine.</Note>
      </Card>
      {outstanding > 0 && (
        <SecondaryButton
          className="w-full"
          onClick={() => {
            dispatch({ type: "another" })
            go(4)
          }}
        >
          Make an M-Pesa sale to see the debts settle
        </SecondaryButton>
      )}
    </>
  )
}

// 9. Payouts: Withdraw at KSh 500+, the 18:00 sweep, the fund never.
function Payouts({ st, dispatch }) {
  const l = st.ledger
  const people = [
    { who: "creator", name: st.creator, icon: Hand },
    { who: "intermediary", name: st.inter, icon: Compass },
  ]
  const fresh = st.notice ? l.payouts.slice(st.notice.from) : []
  return (
    <>
      <Heading title="Payouts" />
      {people.map(({ who, name, icon: Icon }) => {
        const p = payable(l, who)
        return (
          <Card key={who}>
            <p className="flex items-center gap-2 text-sm font-semibold">
              <Icon aria-hidden="true" className="size-4 text-sawa-green" /> {name}
            </p>
            <p className="mt-3 text-[13px] text-sawa-text-muted">Payable now</p>
            <CountUp value={p} className="text-3xl font-bold" />
            {l.paid[who] > 0 && <Note className="mt-1">Paid to M-Pesa so far: {ksh(l.paid[who])}</Note>}
            {p >= THRESHOLD ? (
              <SecondaryButton className="mt-3 w-full" onClick={() => dispatch({ type: "withdraw", who })}>
                <Wallet aria-hidden="true" className="size-4" /> Withdraw {ksh(p)}
              </SecondaryButton>
            ) : (
              <Note className="mt-2">{UNLOCK}</Note>
            )}
          </Card>
        )
      })}
      <Card>
        <p className="flex items-center gap-2 text-sm font-semibold">
          <Leaf aria-hidden="true" className="size-4 text-sawa-green" /> {FUND}
        </p>
        <p className="mt-2 font-mono text-xl font-bold tabular-nums">{ksh(l.available.fund)}</p>
        <Note className="mt-1">Ring-fenced — never paid out by the engine.</Note>
      </Card>
      <SecondaryButton className="w-full" onClick={() => dispatch({ type: "sweep" })}>
        <Clock aria-hidden="true" className="size-4" /> Run the 18:00 sweep
      </SecondaryButton>
      {st.notice && (
        <div aria-live="polite">
          {fresh.length ? (
            <Done>
              {fresh.map((p) => `${ksh(p.amount)} sent to ${poss(p.who === "creator" ? st.creator : st.inter)} M-Pesa`).join("; ")} (simulated).
            </Done>
          ) : (
            <Note>The sweep ran: nobody is at {ksh(THRESHOLD)} yet, so nothing was paid. Debts it could settle are settled.</Note>
          )}
        </div>
      )}
    </>
  )
}

// 10. The coordinator's reconciliation, every sale this session.
function Reconcile({ st }) {
  const t = totals(st.ledger)
  return (
    <>
      <Heading who="Coordinator · Reconciliation" title="Every shilling accounted for" />
      <Card>
        <Row label="M-Pesa collected" value={ksh(t.collected)} strong />
        <div className="border-t border-sawa-border">
          <Row label="Creators" value={ksh(t.creators)} />
          <Row label="Site intermediaries" value={ksh(t.intermediaries)} />
          <Row label={FUND} value={ksh(t.fund)} />
          <Row label="Sawa Split" value={ksh(0)} strong />
        </div>
        <div className="border-t border-sawa-border">
          <Row label="Paid out to M-Pesa" value={ksh(t.paidOut)} />
          <Row label="Still owed (incl. the fund)" value={ksh(t.stillOwed)} />
        </div>
      </Card>
      {t.collected === t.creators + t.intermediaries + t.fund && (
        <Done>Collected = creators + site intermediaries + fund = paid out + still owed.</Done>
      )}
      <Card>
        <p className="text-sm font-semibold">
          {FUND}: <span className="font-mono tabular-nums">{ksh(t.fund)}</span>
        </p>
        <Note className="mt-1">Held for a partner community conservancy, transferred monthly (two approvals) once signed.</Note>
      </Card>
      <Card>
        <p className="text-sm font-semibold">Beside the totals, never in them</p>
        <Row label="Cash recorded" value={ksh(t.cashRecorded)} />
        <Row label="Cash debts still owed by creators" value={ksh(t.cashDebts)} />
      </Card>
      <Card>
        <p className="text-sm font-semibold">
          Sales this session: <span className="font-mono tabular-nums">{st.sales.length}</span>
        </p>
        <ul className="mt-2 flex flex-col">
          {st.sales.map((x) => (
            <li key={x.id} className="flex justify-between gap-3 border-t border-sawa-border py-2 text-[13px] first:border-t-0">
              <span>
                <span className="font-mono tabular-nums">{x.id}</span> · {x.method === "mpesa" ? "M-Pesa" : "Cash"}
                {x.withIntermediary ? ` · ${st.inter}` : " · no intermediary"}
              </span>
              <span className="font-mono tabular-nums">
                {x.split.creator} / {x.split.intermediary} / {x.split.fund}
              </span>
            </li>
          ))}
        </ul>
        <Note className="mt-1">Creator / site intermediary / fund, in KSh.</Note>
      </Card>
    </>
  )
}

function Preview() {
  return (
    <span className="inline-flex items-center self-start rounded-sawa border border-dashed border-sawa-text-muted/60 px-2 py-0.5 text-xs font-semibold text-sawa-text-muted">
      Preview — not live yet
    </span>
  )
}

// 11. Coming next: a static preview, not built.
function ComingNext({ st }) {
  const navigate = useNavigate()
  const items = [
    { icon: ScanLine, title: "One-scan check-in", text: `A group scans their site intermediary's QR once at the start of the day; every stall after that knows who brought them.` },
    { icon: BadgeCheck, title: "Find a verified guide", text: `Tourists find a coordinator-verified site intermediary at ${st.site} before they set out. No ratings, no reviews.` },
    { icon: Landmark, title: "Monthly transfer to the conservancy", text: `The ${FUND.toLowerCase()} goes to a partner community conservancy once a month, with two approvals, reported publicly.` },
  ]
  return (
    <>
      <Preview />
      <h1 className="-mt-3 text-2xl font-semibold">Coming next</h1>
      {items.map(({ icon: Icon, title, text }) => (
        <Card key={title}>
          <p className="flex items-center gap-2 text-sm font-semibold">
            <Icon aria-hidden="true" className="size-4 text-sawa-green" /> {title}
          </p>
          <Note className="mt-2">{text}</Note>
        </Card>
      ))}
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
  // The step lives in the URL (?step=1..11 opens a step directly, doing the ones before
  // it with the defaults); everything else is in memory and starts over on reload.
  const [search, setSearch] = useSearchParams()
  const step = Math.min(Math.max(Number.parseInt(search.get("step"), 10) || 1, 1), LAST)
  const [st, dispatch] = useReducer(reducer, undefined, initial)
  const set = (patch) => dispatch({ type: "set", patch })

  useEffect(() => {
    dispatch({ type: "ensure", step })
  }, [step])

  function go(n) {
    setSearch(new URLSearchParams({ step: String(n) }), { replace: true })
    window.scrollTo({ top: 0 })
  }
  const another = () => {
    dispatch({ type: "another" })
    go(4)
  }
  const reset = () => {
    dispatch({ type: "reset" })
    go(1)
  }

  const s = draftSplit(st)
  const { screen, explain } = STEPS[step - 1]
  const who = screens(st)[screen]
  const ScreenIcon = who.icon
  const props = { st, set, dispatch }

  return (
    <div style={BRAND_BACKGROUND} className="flex min-h-screen flex-col">
      <div role="note" className="sticky top-[57px] z-10 bg-sawa-text px-4 py-2 text-center text-sm font-semibold text-white">
        Demo — no real payment is made
      </div>
      <div className="mx-auto w-full max-w-[1000px] flex-1 px-4 py-6 lg:px-8 lg:py-10">
        <Progress step={step} go={go} />
        <Explain text={explain(st, s)} className="mt-5 lg:hidden" />
        <div className="mt-5 grid items-start gap-8 lg:mt-8 lg:grid-cols-[420px_1fr] lg:gap-14">
          <div>
            <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-white">
              <ScreenIcon aria-hidden="true" className="size-4" /> {who.label}
            </p>
            <main className="flex flex-col gap-6 rounded-[24px] bg-white p-6 shadow-[0_12px_40px_rgba(0,0,0,0.25)] lg:p-8">
              {step === 1 && <Register {...props} />}
              {step === 2 && <StartTour {...props} />}
              {step === 3 && <TourPass {...props} />}
              {step === 4 && <NewSale {...props} />}
              {step === 5 && <ScanStall {...props} />}
              {step === 6 && <Pay {...props} onPaid={() => go(7)} />}
              {step === 7 && <Receipt st={st} />}
              {step === 8 && <Dashboards st={st} dispatch={dispatch} go={go} />}
              {step === 9 && <Payouts st={st} dispatch={dispatch} />}
              {step === 10 && <Reconcile st={st} />}
              {step === 11 && <ComingNext st={st} />}
              {step >= 7 && (
                <div className="flex flex-wrap gap-3 border-t border-sawa-border pt-4">
                  <SecondaryButton onClick={another}>Make another sale</SecondaryButton>
                  <button type="button" onClick={reset} className={`${tapTarget} px-2 text-sm text-sawa-text-muted underline-offset-2 hover:text-sawa-text hover:underline`}>
                    Reset demo
                  </button>
                </div>
              )}
            </main>
          </div>
          <Explain text={explain(st, s)} className="hidden lg:mt-7 lg:block" />
        </div>
      </div>

      {/* Back and Next: always in reach, on a solid navy bar (the page's teal end is too
          light behind white text). Next past a step not yet done does it with the defaults. */}
      <div className="sticky bottom-0 z-10 border-t border-white/15 bg-[#1B2A41]">
        <div className="mx-auto flex max-w-[1000px] items-center justify-between gap-3 px-4 py-2 lg:px-8">
          <button type="button" onClick={() => go(step - 1)} disabled={step === 1} className={`${navButton} text-white hover:bg-white/10`}>
            <ArrowLeft aria-hidden="true" className="size-4" /> Back
          </button>
          <span className="text-sm text-white/85">
            Step <span className="font-mono tabular-nums">{step}</span> of <span className="font-mono tabular-nums">{LAST}</span>
          </span>
          {step < LAST ? (
            <button type="button" onClick={() => go(step + 1)} className={`${navButton} bg-white text-[#1B2A41] hover:bg-white/90`}>
              Next <ArrowRight aria-hidden="true" className="size-4" />
            </button>
          ) : (
            <button type="button" onClick={reset} className={`${navButton} bg-white text-[#1B2A41] hover:bg-white/90`}>
              Start again
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
