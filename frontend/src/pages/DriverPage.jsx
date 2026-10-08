import { useEffect, useState } from "react"
import { useParams } from "react-router-dom"
import { AlertTriangle, Check } from "lucide-react"
import { ErrorNote, Screen } from "../components/ui"
import { api } from "../lib/api"

// What a phone camera opens when a tourist scans a driver's QR card: proof the
// driver is registered. First name and the badge only: no phone, Till or earnings.
export default function DriverPage() {
  const { code } = useParams()
  const [state, setState] = useState({ status: "loading" })

  useEffect(() => {
    let cancelled = false
    api(`/public/drivers/${encodeURIComponent(code)}`)
      .then((driver) => !cancelled && setState({ status: "registered", firstName: driver.first_name }))
      .catch((err) => !cancelled && setState(err.status === 404 ? { status: "unknown" } : { status: "error", message: err.message }))
    return () => {
      cancelled = true
    }
  }, [code])

  return (
    <Screen>
      <section aria-live="polite" className="mt-8 rounded-sawa border border-sawa-border bg-sawa-surface p-6">
        {state.status === "loading" && <p className="text-[15px] text-sawa-text-muted">Checking this driver…</p>}
        {state.status === "registered" && (
          <>
            <h1 className="text-xl font-semibold">
              {state.firstName} — <span className="text-sawa-green">registered Sawa Split driver</span>
              <Check aria-hidden="true" className="ml-1.5 inline size-5 align-[-3px] text-sawa-green" />
            </h1>
            <p className="mt-4 text-[13px] text-sawa-text-muted">
              Their referral fee is disclosed on the stall's price card before you pay.
            </p>
          </>
        )}
        {state.status === "unknown" && (
          <>
            <p className="flex items-center gap-2 text-[15px] font-semibold text-sawa-terracotta">
              <AlertTriangle aria-hidden="true" className="size-5 shrink-0" />
              This isn't a registered Sawa Split driver
            </p>
            <p className="mt-2 font-mono text-[13px] text-sawa-text-muted">{code}</p>
          </>
        )}
        {state.status === "error" && <ErrorNote>{state.message}</ErrorNote>}
      </section>
    </Screen>
  )
}
