import { useCallback, useEffect, useState } from "react"
import { Flag, Users } from "lucide-react"
import { ErrorNote, Field, SecondaryButton } from "./ui"
import { api } from "../lib/api"
import { eatTime, ksh } from "../lib/format"

const POLL_MS = 5000
const MAX_GROUP = 30

// The referrer's tour (SCOPE_V2 MUST 17): a referral counts only for tourists who joined
// a running tour, by scanning the referrer's QR or typing the code at checkout. One tour
// at a time; it ends at midnight, or when they tap End tour.
export default function TourCard({ onChange }) {
  const [tour, setTour] = useState(undefined) // undefined = loading, null = none running
  const [size, setSize] = useState("")
  const [fieldError, setFieldError] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      setTour(await api("/tours/current", { auth: true }))
    } catch (err) {
      setError(err.message)
    }
  }, [])
  useEffect(() => {
    const first = setTimeout(load, 0)
    return () => clearTimeout(first)
  }, [load])
  // Joins arrive from tourists' phones; keep the count fresh while a tour runs.
  useEffect(() => {
    if (!tour) return undefined
    const timer = setInterval(load, POLL_MS)
    return () => clearInterval(timer)
  }, [tour, load])

  async function send(path, body) {
    setBusy(true)
    setError(null)
    try {
      const result = await api(path, { method: "POST", auth: true, body })
      setTour(path === "/tours" ? result : null)
      setSize("")
      onChange?.()
    } catch (err) {
      setError(err.message)
      await load()
    } finally {
      setBusy(false)
    }
  }

  function start(event) {
    event.preventDefault()
    const n = Number(size)
    if (!/^\d+$/.test(size) || n < 1 || n > MAX_GROUP) {
      setFieldError(`How many tourists are with you today? 1 to ${MAX_GROUP}.`)
      return
    }
    setFieldError(null)
    send("/tours", { group_size: n })
  }

  if (tour === undefined) return null

  return (
    <section aria-label="Tour" className="flex flex-col gap-3 rounded-sawa border-2 border-sawa-green bg-sawa-surface p-4">
      {tour ? (
        <>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-xl font-semibold">Tour running</h2>
            <span className="text-[13px] text-sawa-text-muted">Ends at midnight ({eatTime(tour.ends_at)})</span>
          </div>
          <p className="flex items-center gap-2 text-[15px]">
            <Users aria-hidden="true" className="size-4 shrink-0" />
            <span>
              <span className="font-mono font-semibold tabular-nums">
                {tour.joined} of {tour.group_size}
              </span>{" "}
              joined
            </span>
          </p>
          <p className="text-[13px] text-sawa-text-muted">
            {tour.joined < tour.group_size
              ? "Next step: tourists scan your QR to join, or type your code at a stall's checkout."
              : "Your tour is full. Nobody else can join it."}
          </p>
          <p className="text-[13px] text-sawa-text-muted">
            This tour: <span className="font-mono tabular-nums">{tour.sales}</span> {tour.sales === 1 ? "sale" : "sales"} ·{" "}
            <span className="font-mono tabular-nums">{ksh(tour.commission)}</span> earned
          </p>
          <SecondaryButton className="w-full" onClick={() => send("/tours/current/end", undefined)} disabled={busy}>
            <Flag aria-hidden="true" className="size-4 shrink-0" />
            {busy ? "Ending…" : "End tour"}
          </SecondaryButton>
        </>
      ) : (
        <form onSubmit={start} noValidate className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold">Start tour</h2>
          <p className="text-[13px] text-sawa-text-muted">
            You earn your referral share only from tourists who join your tour today.
          </p>
          <Field
            id="tour-size"
            label="Group size (1 to 30)"
            inputMode="numeric"
            pattern="[0-9]*"
            value={size}
            onChange={(e) => setSize(e.target.value.trim())}
            error={fieldError}
          />
          <SecondaryButton type="submit" disabled={busy} className="w-full">
            <Users aria-hidden="true" className="size-4 shrink-0" />
            {busy ? "Starting…" : "Start tour"}
          </SecondaryButton>
        </form>
      )}
      <ErrorNote>{error}</ErrorNote>
    </section>
  )
}
