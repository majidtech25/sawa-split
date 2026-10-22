import { useCallback, useEffect, useRef, useState } from "react"
import { useParams, useSearchParams } from "react-router-dom"
import { AlertTriangle, Check, Clock, Hourglass } from "lucide-react"
import PriceTransparencyCard from "../components/PriceTransparencyCard"
import { ErrorNote, Screen, SecondaryButton, StatusBadge, VerifiedStamp } from "../components/ui"
import { api } from "../lib/api"
import { cardProps } from "../lib/checkout"
import { ksh } from "../lib/format"

const SETTLED = new Set(["confirmed", "failed", "cash_confirmed", "cash_expired", "disputed"])

function receiptCard(r) {
  return cardProps({
    site: r.site,
    producerName: r.producer_name,
    driverName: r.driver_name,
    product: r.product_amount ? { amount: r.product_amount, maker_amount: r.product_maker_amount, driver_amount: r.product_driver_amount } : null,
    photo: r.photo_amount ? { amount: r.photo_amount } : null,
    total: r.total_amount,
    service: r.business_type === "service",
  })
}

// A short, readable reference for the tourist (MUST 18d), from the payment's own id.
const receiptNumber = (id) => `SS-${id.replaceAll("-", "").slice(0, 8).toUpperCase()}`

// The cash sale's next step, in words (MUST 18a, 18e): it isn't confirmed until both
// required people have confirmed, and the page says who it's still waiting for.
function cashNextStep(r) {
  const waiting = []
  if (r.driver_name) {
    if (!r.maker_confirmed) waiting.push(r.producer_name)
    if (!r.driver_confirmed) waiting.push(r.driver_name)
    if (waiting.length === 2) return "Waiting for the seller and site intermediary to confirm"
  } else {
    if (!r.tourist_confirmed) waiting.push("you")
    if (!r.maker_confirmed) waiting.push(r.tourist_confirmed ? r.producer_name : "the seller")
  }
  return `Waiting for ${waiting.join(" and ")} to confirm`
}

function useCountdown(deadline) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!deadline) return undefined
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [deadline])
  if (!deadline) return null
  const left = Math.max(0, new Date(deadline).getTime() - now)
  const m = Math.floor(left / 60000)
  const s = Math.floor((left % 60000) / 1000)
  return { left, label: `${m}:${String(s).padStart(2, "0")}` }
}

function ConfirmStep({ done, children }) {
  return (
    <li className={`flex items-center gap-2 text-sm ${done ? "text-sawa-green" : "text-sawa-text-muted"}`}>
      {done ? <Check aria-hidden="true" className="size-4" /> : <Hourglass aria-hidden="true" className="size-4" />}
      <span>
        {children} · {done ? "confirmed" : "not yet"}
      </span>
    </li>
  )
}

export default function ReceiptPage() {
  const { transactionId } = useParams()
  const [search] = useSearchParams()
  const touristToken = search.get("t")
  const [receipt, setReceipt] = useState(null)
  const [error, setError] = useState(null)
  const [confirming, setConfirming] = useState(false)
  const [confirmError, setConfirmError] = useState(null)

  const statusRef = useRef(null)

  const load = useCallback(async () => {
    try {
      const next = await api(`/public/transactions/${transactionId}`)
      statusRef.current = next.status
      setReceipt(next)
      setError(null)
    } catch (err) {
      setError(err.message)
    }
  }, [transactionId])

  // Poll until the payment settles: the STK callback or the last cash confirmation
  // can land at any moment, and the tourist has no account to receive a push.
  useEffect(() => {
    const first = setTimeout(load, 0)
    const timer = setInterval(() => {
      if (!SETTLED.has(statusRef.current)) load()
    }, 2500)
    return () => {
      clearTimeout(first)
      clearInterval(timer)
    }
  }, [load])

  const countdown = useCountdown(receipt?.status === "cash_unconfirmed" ? receipt.confirmation_deadline : null)

  async function touristConfirm() {
    setConfirming(true)
    setConfirmError(null)
    try {
      await api(`/transactions/${transactionId}/confirm`, { method: "POST", body: { tourist_token: touristToken } })
      await load()
    } catch (err) {
      setConfirmError(err.message)
    } finally {
      setConfirming(false)
    }
  }

  if (!receipt) {
    return (
      <Screen>
        {error ? <ErrorNote>{error}</ErrorNote> : <p className="text-sm text-sawa-text-muted">Loading your payment…</p>}
      </Screen>
    )
  }

  const card = receiptCard(receipt)
  const isCash = receipt.payment_method === "cash"
  const caseB = isCash && !receipt.driver_name

  return (
    <Screen className="flex flex-col gap-6">
      {receipt.status === "initiated" && (
        <section aria-live="polite" className="rounded-sawa border border-sawa-border bg-sawa-surface p-5 shadow-[0_3px_16px_rgba(26,26,26,0.10)]">
          <StatusBadge status="initiated" />
          <h1 className="mt-3 text-2xl font-semibold">Check your phone</h1>
          <p className="mt-1 text-[15px] text-sawa-text-muted">
            Enter your M-Pesa PIN in the prompt to pay <span className="font-mono">{ksh(receipt.total_amount)}</span>. This
            page updates on its own.
          </p>
        </section>
      )}

      {receipt.status === "verifying" && (
        <section aria-live="polite" className="rounded-sawa border border-sawa-border bg-sawa-surface p-5">
          <StatusBadge status="verifying" />
          <h1 className="mt-3 text-2xl font-semibold">Payment being verified</h1>
          <p className="mt-1 text-[15px] text-sawa-text-muted">
            M-Pesa says you paid <span className="font-mono">{ksh(receipt.total_amount)}</span>. We're confirming it with
            Safaricom before the split is credited. You don't need to do anything; this page updates on its own.
          </p>
          {receipt.stk_receipt && (
            <p className="mt-2 font-mono text-[13px] text-sawa-text-muted">M-Pesa receipt {receipt.stk_receipt}</p>
          )}
        </section>
      )}

      {(receipt.status === "confirmed" || receipt.status === "cash_confirmed") && (
        <section aria-live="polite" className="flex items-center gap-5">
          <VerifiedStamp amount={receipt.total_amount} at={receipt.created_at} place={receipt.site} />
          <div>
            <StatusBadge status={receipt.status} />
            <h1 className="mt-2 text-2xl font-semibold">{isCash ? "Cash payment confirmed" : "Payment confirmed"}</h1>
            <p className="mt-1 text-[15px] text-sawa-text-muted">
              {isCash
                ? "Both confirmed. The split is recorded."
                : "The split is recorded and each share is credited to their balance."}
            </p>
            {receipt.stk_receipt && (
              <p className="mt-2 font-mono text-[13px] text-sawa-text-muted">M-Pesa receipt {receipt.stk_receipt}</p>
            )}
          </div>
        </section>
      )}

      {receipt.status === "failed" && (
        <section aria-live="polite" className="rounded-sawa border border-sawa-terracotta/40 bg-sawa-surface p-5">
          <p className="flex items-center gap-2 text-sm font-semibold text-sawa-terracotta">
            <AlertTriangle aria-hidden="true" className="size-4" /> Payment didn't go through
          </p>
          <p className="mt-2 text-[15px]">
            Nothing was charged. The prompt may have timed out or been cancelled. Go back and tap Pay again when you're ready.
          </p>
          <SecondaryButton className="mt-4" onClick={() => window.history.back()}>
            Back to payment
          </SecondaryButton>
        </section>
      )}

      {receipt.status === "cash_unconfirmed" && (
        <section aria-live="polite" className="rounded-sawa border border-dashed border-sawa-text-muted/50 bg-sawa-surface p-5">
          <StatusBadge status="cash_unconfirmed" />
          <h1 className="mt-3 text-2xl font-semibold">{cashNextStep(receipt)}</h1>
          <p className="mt-1 text-[15px] text-sawa-text-muted">
            You paid cash. Nothing is split until both confirmations are in.
          </p>
          <ul className="mt-4 flex flex-col gap-1.5">
            <ConfirmStep done={receipt.maker_confirmed}>Seller · {receipt.producer_name}</ConfirmStep>
            {receipt.driver_name ? (
              <ConfirmStep done={receipt.driver_confirmed}>Intermediary · {receipt.driver_name}</ConfirmStep>
            ) : (
              <ConfirmStep done={receipt.tourist_confirmed}>You</ConfirmStep>
            )}
          </ul>
          {countdown && (
            <p className="mt-4 flex items-center gap-2 text-[13px] text-sawa-text-muted">
              <Clock aria-hidden="true" className="size-4" />
              <span>
                Confirmation window closes in <span className="font-mono tabular-nums">{countdown.label}</span>
              </span>
            </p>
          )}
          {caseB && !receipt.tourist_confirmed && touristToken && (
            <SecondaryButton className="mt-4 w-full" onClick={touristConfirm} disabled={confirming}>
              <Check aria-hidden="true" className="size-4" />
              {confirming ? "Confirming…" : `I paid ${ksh(receipt.total_amount)} in cash`}
            </SecondaryButton>
          )}
          <div className="mt-3">
            <ErrorNote>{confirmError}</ErrorNote>
          </div>
        </section>
      )}

      {receipt.status === "cash_expired" && (
        <section aria-live="polite" className="rounded-sawa border border-sawa-text bg-sawa-surface p-5">
          <StatusBadge status="cash_expired" />
          <h1 className="mt-3 text-2xl font-semibold">Not confirmed in time</h1>
          <p className="mt-1 text-[15px] text-sawa-text-muted">
            This cash payment wasn't confirmed within the window, so nothing was split. It stays on record for the
            coordinator to follow up.
          </p>
        </section>
      )}

      {receipt.status === "disputed" && (
        <section aria-live="polite" className="rounded-sawa border border-sawa-border bg-sawa-surface p-5">
          <StatusBadge status="disputed" />
          <p className="mt-2 text-[15px] text-sawa-text-muted">A coordinator is reviewing this payment.</p>
        </section>
      )}

      <PriceTransparencyCard {...card} />

      <section aria-label="Receipt" className="flex flex-col gap-1 text-[13px] text-sawa-text-muted">
        <p>
          Receipt <span className="font-mono text-sawa-text">{receiptNumber(receipt.id)}</span>
        </p>
        <p>Nothing was taken out for Sawa Split.</p>
        {(receipt.status === "confirmed" || receipt.status === "cash_confirmed") && <p>Tip: screenshot this receipt.</p>}
      </section>
    </Screen>
  )
}
