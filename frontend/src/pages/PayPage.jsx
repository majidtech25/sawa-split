import { useState } from "react"
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom"
import { Banknote, Smartphone } from "lucide-react"
import PriceTransparencyCard from "../components/PriceTransparencyCard"
import { ErrorNote, Field, PayButton, Screen, SecondaryButton } from "../components/ui"
import { api } from "../lib/api"
import { cardFromCheckout, useCheckout } from "../lib/checkout"
import { ksh } from "../lib/format"

function Loading() {
  return <p className="text-sm text-sawa-text-muted">Loading the price card…</p>
}

// Step 1 — the price-transparency card, read-only, shown before any money moves.
export function PriceCardPage() {
  const { producerId } = useParams()
  const [search] = useSearchParams()
  const { loading, checkout, error } = useCheckout(producerId, search)

  return (
    <Screen>
      <h1 className="text-2xl font-semibold">Before you pay</h1>
      <p className="mt-1 text-[15px] text-sawa-text-muted">
        Exactly where your money goes. Nothing is taken out for Sawa Split.
      </p>
      <div className="mt-6 flex flex-col gap-4">
        {loading && <Loading />}
        <ErrorNote>{error}</ErrorNote>
        {checkout && (
          <>
            <PriceTransparencyCard {...cardFromCheckout(checkout)} />
            {checkout.driver && (
              <p className="text-[13px] text-sawa-text-muted">
                {checkout.driver.name} referred this visit. Their fee is the {Number(checkout.driver_split_pct)}% driver
                referral shown above, disclosed here and checked against their registered QR code.
              </p>
            )}
            <Link
              to={`/pay/${producerId}/checkout?${search.toString()}`}
              className="inline-flex items-center justify-center rounded-sawa border border-sawa-green px-4 py-2.5 text-sm font-semibold text-sawa-green hover:bg-sawa-green hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sawa-green"
            >
              Continue to payment
            </Link>
          </>
        )}
      </div>
    </Screen>
  )
}

const PHONE_PATTERN = /^(\+?254|0)?[17]\d{8}$/

// Step 2 — payment entry: M-Pesa (the one ochre button) or cash.
export function CheckoutPage() {
  const { producerId } = useParams()
  const [search] = useSearchParams()
  const navigate = useNavigate()
  const { loading, checkout, error } = useCheckout(producerId, search)
  const [phone, setPhone] = useState("")
  const [phoneError, setPhoneError] = useState(null)
  const [submitError, setSubmitError] = useState(null)
  const [busy, setBusy] = useState(null)

  function initiateBody(method) {
    return {
      producer_id: checkout.producer.id,
      driver_id: checkout.driver?.id ?? null,
      payment_method: method,
      product_enabled: Boolean(checkout.product),
      product_amount: checkout.product ? checkout.product.amount : null,
      photo_enabled: Boolean(checkout.photo),
      photo_amount: checkout.photo ? checkout.photo.amount : null,
    }
  }

  async function payMpesa(event) {
    event?.preventDefault()
    const digits = phone.replace(/[\s-]/g, "")
    if (!PHONE_PATTERN.test(digits)) {
      setPhoneError("Enter a Safaricom number, like 0712 345 678.")
      return
    }
    setPhoneError(null)
    setSubmitError(null)
    setBusy("mpesa")
    try {
      const txn = await api("/transactions/initiate", { method: "POST", body: { ...initiateBody("mpesa"), phone: digits } })
      navigate(`/receipt/${txn.id}`)
    } catch (err) {
      setSubmitError(err.message)
      setBusy(null)
    }
  }

  async function payCash() {
    setSubmitError(null)
    setBusy("cash")
    try {
      const txn = await api("/transactions/initiate", { method: "POST", body: initiateBody("cash") })
      // A walk-up cash sale (no driver) is confirmed by the tourist herself with this token.
      navigate(`/receipt/${txn.id}${txn.tourist_confirm_token ? `?t=${encodeURIComponent(txn.tourist_confirm_token)}` : ""}`)
    } catch (err) {
      setSubmitError(err.message)
      setBusy(null)
    }
  }

  return (
    <Screen>
      {loading && <Loading />}
      <ErrorNote>{error}</ErrorNote>
      {checkout && (
        <div className="flex flex-col gap-6">
          <PriceTransparencyCard {...cardFromCheckout(checkout)} />

          <form onSubmit={payMpesa} className="flex flex-col gap-4" noValidate>
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
                {busy === "mpesa" ? "Sending the M-Pesa prompt…" : `Pay ${ksh(checkout.total_amount)}`}
              </span>
            </PayButton>
          </form>

          <div className="flex flex-col gap-2 border-t border-sawa-border pt-5">
            <SecondaryButton onClick={payCash} disabled={busy !== null}>
              <Banknote aria-hidden="true" className="size-4" />
              {busy === "cash" ? "Recording the cash payment…" : `Paid ${ksh(checkout.total_amount)} in cash`}
            </SecondaryButton>
            <p className="text-[13px] text-sawa-text-muted">
              Cash is split the same way once{" "}
              {checkout.driver ? `${checkout.driver.name} and ${checkout.producer.name} both confirm` : `you and ${checkout.producer.name} both confirm`}{" "}
              it was paid.
            </p>
          </div>

          <ErrorNote>{submitError}</ErrorNote>
        </div>
      )}
    </Screen>
  )
}
