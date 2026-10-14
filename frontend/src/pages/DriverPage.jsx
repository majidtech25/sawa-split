import { useEffect, useState } from "react"
import { useParams } from "react-router-dom"
import { AlertTriangle, Check } from "lucide-react"
import { ErrorNote, Screen, SecondaryButton } from "../components/ui"
import { api } from "../lib/api"
import { clearTourPass, readTourPass, saveTourPass } from "../lib/tourPass"

// What a phone camera opens when a tourist scans a driver's QR card: proof the
// driver is registered. First name and the badge only: no phone, Till or earnings.
export default function DriverPage() {
  const { code } = useParams()
  const [state, setState] = useState({ status: "loading" })
  const [pass, setPass] = useState(readTourPass)
  const [storageError, setStorageError] = useState(null)

  useEffect(() => {
    let cancelled = false
    api(`/public/drivers/${encodeURIComponent(code)}`)
      .then((driver) => !cancelled && setState({ status: "registered", firstName: driver.first_name, code: driver.referral_code }))
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
            {/* The tour pass (SCOPE_V2 MUST 3): this guide's code fills in at every stall today. */}
            <div className="mt-5 border-t border-sawa-border pt-4">
              {pass?.code === state.code ? (
                <>
                  <p className="flex items-center gap-2 text-[15px] font-semibold text-sawa-green">
                    <Check aria-hidden="true" className="size-4 shrink-0" /> {state.firstName} is your guide today
                  </p>
                  <p className="mt-1 text-[13px] text-sawa-text-muted">
                    Their code {state.code} fills in at each stall's checkout until midnight. You can still change or
                    remove it there.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      clearTourPass()
                      setPass(null)
                    }}
                    className="mt-2 text-sm text-sawa-text-muted underline-offset-2 hover:text-sawa-text hover:underline"
                  >
                    Stop using {state.firstName} as my guide
                  </button>
                </>
              ) : (
                <>
                  <SecondaryButton
                    className="w-full"
                    onClick={() => {
                      if (saveTourPass(state.code, state.firstName)) {
                        setPass(readTourPass())
                        setStorageError(null)
                      } else {
                        setStorageError(`This browser can't save it. Type ${state.code} at checkout instead.`)
                      }
                    }}
                  >
                    Use {state.firstName} as my guide today
                  </SecondaryButton>
                  {pass?.code && (
                    <p className="mt-2 text-[13px] text-sawa-text-muted">This replaces {pass.firstName || pass.code} as your guide.</p>
                  )}
                  <div className="mt-2">
                    <ErrorNote>{storageError}</ErrorNote>
                  </div>
                </>
              )}
            </div>
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
