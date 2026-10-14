import { useCallback, useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { Check, Clock, Printer, X } from "lucide-react"
import { ErrorNote, Field, SecondaryButton } from "./ui"
import { api } from "../lib/api"
import { ksh } from "../lib/format"

const POLL_MS = 3000

// Live status of the maker's latest sale, in words (SCOPE_V2 MUST 4).
const STATUS = {
  open: { label: "Waiting for payment", tone: "text-sawa-text-muted" },
  paying: { label: "Payment in progress", tone: "text-sawa-text-muted" },
  paid: { label: "Paid", tone: "text-sawa-green", icon: <Check aria-hidden="true" className="size-4" /> },
  expired: { label: "Expired: not paid within 30 minutes", tone: "text-sawa-text", icon: <Clock aria-hidden="true" className="size-4" /> },
  cancelled: { label: "Cancelled", tone: "text-sawa-text-muted", icon: <X aria-hidden="true" className="size-4" /> },
}

function minutesLeft(iso) {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 60000))
}

// The maker types the agreed amount; the tourist pays it from the stall's stand QR.
export default function NewSale({ stallCode, photoFee, onChange }) {
  const [sale, setSale] = useState(undefined) // undefined = loading, null = none yet
  const [amount, setAmount] = useState("")
  const [description, setDescription] = useState("")
  const [photo, setPhoto] = useState(false)
  const [fieldError, setFieldError] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      setSale(await api("/sales/current", { auth: true }))
    } catch (err) {
      setError(err.message)
    }
  }, [])
  useEffect(() => {
    const first = setTimeout(load, 0)
    return () => clearTimeout(first)
  }, [load])
  const active = sale && (sale.status === "open" || sale.status === "paying")
  useEffect(() => {
    if (!active) return undefined
    const timer = setInterval(load, POLL_MS)
    return () => clearInterval(timer)
  }, [active, load])
  // When a sale finishes, refresh the rest of the dashboard (balances, sales list).
  const finished = sale && !active ? sale.status : null
  useEffect(() => {
    if (finished) onChange?.()
  }, [finished, onChange])

  async function create(event) {
    event.preventDefault()
    setError(null)
    if (!/^[1-9]\d*$/.test(amount)) {
      setFieldError("Enter the agreed amount in whole shillings, like 1500.")
      return
    }
    setFieldError(null)
    setBusy(true)
    try {
      setSale(await api("/sales", { method: "POST", auth: true, body: { amount: Number(amount), description: description.trim() || null, photo } }))
      setAmount("")
      setDescription("")
      setPhoto(false)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function cancel() {
    setBusy(true)
    setError(null)
    try {
      setSale(await api(`/sales/${sale.id}/cancel`, { method: "POST", auth: true }))
    } catch (err) {
      setError(err.message)
      await load()
    } finally {
      setBusy(false)
    }
  }

  const status = sale && STATUS[sale.status]
  return (
    <section aria-label="New sale" className="flex flex-col gap-3 rounded-sawa border border-sawa-border bg-sawa-surface p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">New sale</h2>
        <Link to={`/stand/${encodeURIComponent(stallCode)}`} className="inline-flex items-center gap-1.5 text-sm text-sawa-green hover:underline">
          <Printer aria-hidden="true" className="size-4" /> Print my stand QR
        </Link>
      </div>

      {sale && (
        <div aria-live="polite" className="rounded-sawa border border-sawa-border p-3">
          <div className="flex items-baseline justify-between gap-3">
            <span className="font-mono text-2xl font-bold tabular-nums">{ksh(sale.total_amount)}</span>
            <span className={`inline-flex items-center gap-1.5 text-sm font-semibold ${status.tone}`}>
              {status.icon ?? <span aria-hidden="true" className="size-2 animate-pulse rounded-full bg-sawa-text-muted motion-reduce:animate-none" />}
              {status.label}
            </span>
          </div>
          <p className="mt-1 text-[13px] text-sawa-text-muted">
            {ksh(sale.amount)}
            {sale.photo_fee ? ` + ${ksh(sale.photo_fee)} photo consent` : ""}
            {sale.description ? ` · ${sale.description}` : ""}
          </p>
          {sale.status === "open" && (
            <p className="mt-1 text-[13px] text-sawa-text-muted">
              The tourist scans your stand QR to pay. Expires in {minutesLeft(sale.expires_at)} min.
            </p>
          )}
          {sale.status === "paying" && (
            <p className="mt-1 text-[13px] text-sawa-text-muted">
              {sale.payment_method === "cash" ? "Cash: confirm you received it in Recent sales below." : "M-Pesa: waiting for the tourist's PIN."}
              {sale.referrer_first_name ? ` Guide: ${sale.referrer_first_name}.` : ""}
            </p>
          )}
          {sale.status === "paid" && sale.referrer_first_name && (
            <p className="mt-1 text-[13px] text-sawa-text-muted">Guide: {sale.referrer_first_name}.</p>
          )}
          {sale.status === "open" && (
            <button type="button" onClick={cancel} disabled={busy} className="mt-2 text-sm text-sawa-text-muted underline-offset-2 hover:text-sawa-text hover:underline">
              Cancel this sale
            </button>
          )}
        </div>
      )}

      {!active && sale !== undefined && (
        <form onSubmit={create} noValidate className="flex flex-col gap-3">
          <Field
            id="sale-amount"
            label="Agreed amount (KSh)"
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(e.target.value.trim())}
            error={fieldError}
          />
          <Field id="sale-description" label="What it's for (optional)" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} />
          {photoFee && (
            <label className="flex items-center gap-3 text-[15px]">
              <input type="checkbox" checked={photo} onChange={(e) => setPhoto(e.target.checked)} className="size-[18px] accent-sawa-green" />
              Photo consent (+{ksh(photoFee)}, all to you)
            </label>
          )}
          <SecondaryButton type="submit" disabled={busy}>
            {busy ? "Starting…" : "Start the sale"}
          </SecondaryButton>
        </form>
      )}
      <ErrorNote>{error}</ErrorNote>
    </section>
  )
}
