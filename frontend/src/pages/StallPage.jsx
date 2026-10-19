import { useEffect, useRef, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { Banknote, Check, Smartphone } from "lucide-react"
import PriceTransparencyCard from "../components/PriceTransparencyCard"
import { ErrorNote, Field, PayButton, Screen, SecondaryButton } from "../components/ui"
import { api } from "../lib/api"
import { cardFromCheckout } from "../lib/checkout"
import { ksh } from "../lib/format"
import { canSaveTourPass, clearTourPass, readTourPass, saveTourPass } from "../lib/tourPass"

const POLL_MS = 3000
const PHONE_PATTERN = /^(\+?254|0)?[17]\d{8}$/

// The page a maker's static stand QR opens (SCOPE_V2 MUST 5): waits for the seller to
// enter a sale, then shows it with the server's breakdown and takes the payment. Reads
// only the public API: no table access from the browser.
export default function StallPage() {
  const { code } = useParams()
  const [stall, setStall] = useState(null)
  const [error, setError] = useState(null)
  const [paying, setPaying] = useState(false) // stop polling once the tourist starts paying

  useEffect(() => {
    if (paying) return undefined
    let live = true
    const load = () =>
      api(`/public/stalls/${encodeURIComponent(code)}`)
        .then((s) => {
          if (!live) return
          setStall(s)
          setError(null)
        })
        .catch((err) => live && setError(err.message))
    load()
    const timer = setInterval(load, POLL_MS)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [code, paying])

  if (!stall) {
    return <Screen>{error ? <ErrorNote>{error}</ErrorNote> : <p className="text-sm text-sawa-text-muted">Loading the stall…</p>}</Screen>
  }

  const sale = stall.sale
  return (
    <Screen className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold">{stall.maker.name}</h1>
        {stall.site && <p className="text-[15px] text-sawa-text-muted">{stall.site}</p>}
      </div>
      {!sale && (
        <section aria-live="polite" className="rounded-sawa border border-sawa-border bg-sawa-surface p-5">
          <p className="flex items-center gap-2 text-[15px]">
            <span aria-hidden="true" className="size-2 animate-pulse rounded-full bg-sawa-text-muted motion-reduce:animate-none" />
            Waiting for the seller to enter the amount
          </p>
          <p className="mt-1 text-[13px] text-sawa-text-muted">This page updates on its own.</p>
        </section>
      )}
      {sale?.status === "paying" && !paying && (
        <section aria-live="polite" className="rounded-sawa border border-sawa-border bg-sawa-surface p-5 text-[15px]">
          A payment for this sale is already in progress. If it isn't yours, wait for the seller.
        </section>
      )}
      {sale?.status === "open" && <SaleCheckout key={sale.id} sale={sale} onPaying={setPaying} />}
      <ErrorNote>{error}</ErrorNote>
    </Screen>
  )
}

function SaleCheckout({ sale, onPaying }) {
  const navigate = useNavigate()
  const [pass, setPass] = useState(readTourPass)
  // MUST 16: with a tour pass, the tourist first says whether they're still with that guide.
  const [stillWith, setStillWith] = useState(() => (readTourPass() ? null : false))
  const [code, setCode] = useState(() => readTourPass()?.code || "")
  const [requote, setRequote] = useState(0)
  const [quote, setQuote] = useState(null)
  const [quoteError, setQuoteError] = useState(null)
  const [quoteFailed, setQuoteFailed] = useState(false) // couldn't be loaded, even after a retry
  const [phone, setPhone] = useState("")
  const [phoneError, setPhoneError] = useState(null)
  const [submitError, setSubmitError] = useState(null)
  const [busy, setBusy] = useState(null)
  const timer = useRef(null)

  // The pass's join token counts only for the guide it was issued for.
  const joinToken = pass?.joinToken && pass.code.toUpperCase() === code.trim().toUpperCase() ? pass.joinToken : null

  // The breakdown always comes from the server (SCOPE_V2 MUST 6), for the code as typed
  // and the tourist's join to that guide's tour (MUST 17).
  useEffect(() => {
    clearTimeout(timer.current)
    let live = true
    timer.current = setTimeout(() => {
      const query = new URLSearchParams()
      if (code.trim()) query.set("ref", code.trim())
      if (joinToken) query.set("join", joinToken)
      const path = `/public/sales/${sale.id}${query.toString() ? `?${query}` : ""}`
      // A failed load (no connection, or a server error) is retried once after 2 s; a real
      // answer such as "Sale not found" (4xx) is shown as it is.
      const unreachable = (err) => !err.status || err.status >= 500
      api(path)
        .catch((err) => (unreachable(err) ? new Promise((r) => setTimeout(r, 2000)).then(() => api(path)) : Promise.reject(err)))
        .then((q) => {
          if (!live) return
          setQuote(q)
          setQuoteError(null)
          setQuoteFailed(false)
        })
        .catch((err) => {
          if (!live) return
          setQuoteFailed(unreachable(err))
          setQuoteError(unreachable(err) ? null : err.message)
        })
    }, 350)
    return () => {
      live = false
      clearTimeout(timer.current)
    }
  }, [code, joinToken, sale.id, requote])

  const codeProblem = code.trim() && quote?.referral_error
  const validCode = quote?.driver && !quote.referral_error ? code.trim() : null

  function doneWithGuide() {
    clearTourPass()
    setPass(null)
    setCode("")
    setStillWith(false)
  }

  // A code typed here joins that guide's tour first, so the join is counted once and
  // the next stall reuses it (MUST 17).
  async function ensureJoin() {
    if (!validCode || joinToken) return joinToken
    const joined = await api(`/public/drivers/${encodeURIComponent(validCode)}/join`, { method: "POST" })
    if (canSaveTourPass()) {
      saveTourPass(joined.referral_code, joined.first_name, joined.join_token)
      setPass(readTourPass())
    }
    return joined.join_token
  }

  async function pay(method) {
    setSubmitError(null)
    if (codeProblem) {
      setSubmitError("Remove the guide code to pay without a guide, or fix it.")
      return
    }
    const body = { payment_method: method, referral_code: validCode }
    if (method === "mpesa") {
      const digits = phone.replace(/[\s-]/g, "")
      if (!PHONE_PATTERN.test(digits)) {
        setPhoneError("Enter a Safaricom number, like 0712 345 678.")
        return
      }
      setPhoneError(null)
      body.phone = digits
    }
    setBusy(method)
    onPaying(true)
    try {
      try {
        body.join_token = await ensureJoin()
      } catch (err) {
        // No tour running, or it just filled up: show why, with the new breakdown.
        setRequote((n) => n + 1)
        throw err
      }
      const txn = await api(`/public/sales/${sale.id}/pay`, { method: "POST", body })
      navigate(`/receipt/${txn.id}${txn.tourist_confirm_token ? `?t=${encodeURIComponent(txn.tourist_confirm_token)}` : ""}`)
    } catch (err) {
      setSubmitError(err.message)
      setBusy(null)
      onPaying(false)
    }
  }

  if (stillWith === null) {
    return (
      <section aria-label="Your guide" className="flex flex-col gap-3 rounded-sawa border border-sawa-border bg-sawa-surface p-5">
        <h2 className="text-lg font-semibold">Still with {pass.firstName || pass.code}?</h2>
        <p className="text-[13px] text-sawa-text-muted">
          If {pass.firstName || "your guide"} brought you here, they get their disclosed share of this sale.
        </p>
        <div className="flex flex-wrap gap-3">
          <SecondaryButton onClick={() => setStillWith(true)}>Yes, still with {pass.firstName || pass.code}</SecondaryButton>
          <SecondaryButton onClick={doneWithGuide}>No, not with {pass.firstName || pass.code}</SecondaryButton>
        </div>
      </section>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      {sale.description && <p className="text-[15px]">{sale.description}</p>}

      <div className="flex flex-col gap-1.5">
        <Field
          id="guide-code"
          label="Guide code (optional)"
          autoComplete="off"
          autoCapitalize="characters"
          placeholder="e.g. JAMES"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          error={codeProblem ? quote.referral_error : null}
          hint={quote?.driver ? null : "If a guide brought you here, their code gives them their disclosed share."}
        />
        {quote?.driver && !codeProblem && (
          <p className="flex items-center gap-2 text-sm text-sawa-green">
            <Check aria-hidden="true" className="size-4 shrink-0" /> Guide · {quote.driver.name}
          </p>
        )}
        {code && (
          <div>
            <button type="button" onClick={() => setCode("")} className="inline-flex min-h-11 items-center text-sm text-sawa-text-muted underline-offset-2 hover:text-sawa-text hover:underline">
              Remove the guide code
            </button>
          </div>
        )}
      </div>

      <ErrorNote>{quoteError}</ErrorNote>
      {quoteFailed && (
        <div role="alert" className="flex flex-col items-start gap-2 rounded-sawa border border-sawa-terracotta/40 bg-white p-3">
          <p className="text-sm text-sawa-terracotta">Couldn't load the price.</p>
          <SecondaryButton onClick={() => setRequote((n) => n + 1)}>Try again</SecondaryButton>
        </div>
      )}
      {quote && <PriceTransparencyCard {...cardFromCheckout(quote)} />}
      {quote?.driver && (
        <p className="text-[13px] text-sawa-text-muted">
          {quote.driver.name}'s share is the {Number(quote.driver_split_pct)}% guide referral the maker agreed with the
          coordinator, rounded down to whole shillings. Everything else goes to the maker. Nothing is taken out for Sawa
          Split.
        </p>
      )}

      {quote && (
        <>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              pay("mpesa")
            }}
            className="flex flex-col gap-4"
            noValidate
          >
            <Field
              id="pay-phone"
              label="M-Pesa phone number"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="07XX XXX XXX"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              error={phoneError}
              hint="An M-Pesa prompt opens on this phone. Enter your PIN there."
            />
            <PayButton type="submit" busy={busy !== null}>
              <span className="inline-flex items-center justify-center gap-2">
                <Smartphone aria-hidden="true" className="size-4" />
                {busy === "mpesa" ? "Sending the M-Pesa prompt…" : `Pay ${ksh(quote.total_amount)}`}
              </span>
            </PayButton>
          </form>
          <div className="flex flex-col gap-2 border-t border-sawa-border pt-5">
            <SecondaryButton onClick={() => pay("cash")} disabled={busy !== null}>
              <Banknote aria-hidden="true" className="size-4" />
              {busy === "cash" ? "Recording the cash payment…" : `Paid ${ksh(quote.total_amount)} in cash`}
            </SecondaryButton>
            <p className="text-[13px] text-sawa-text-muted">
              Cash is split the same way once{" "}
              {quote.driver ? `${quote.driver.name} and ${quote.producer.name} both confirm` : `you and ${quote.producer.name} both confirm`} it
              was paid.
            </p>
          </div>
        </>
      )}
      <ErrorNote>{submitError}</ErrorNote>
    </div>
  )
}
