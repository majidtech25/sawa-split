import { useEffect, useState } from "react"
import { useParams } from "react-router-dom"
import { AlertTriangle, Check, Minus } from "lucide-react"
import { ErrorNote, Screen, SecondaryButton } from "../components/ui"
import { api } from "../lib/api"
import { referrerType } from "../lib/format"
import { canSaveTourPass, clearTourPass, readTourPass, saveTourPass } from "../lib/tourPass"

// What a phone camera opens when a tourist scans a guide's QR card: proof they're
// registered and active (SCOPE_V2 MUST 12), and joining their tour (MUST 17). First
// name, type and status only: no phone, Till, earnings, or why someone isn't active.
export default function DriverPage() {
  const { code } = useParams()
  const [state, setState] = useState({ status: "loading" })
  const [pass, setPass] = useState(readTourPass)
  const [joinError, setJoinError] = useState(null)
  const [joining, setJoining] = useState(false)

  useEffect(() => {
    let cancelled = false
    api(`/public/drivers/${encodeURIComponent(code)}`)
      .then((guide) => !cancelled && setState({ status: "registered", guide }))
      .catch((err) => !cancelled && setState(err.status === 404 ? { status: "unknown" } : { status: "error", message: err.message }))
    return () => {
      cancelled = true
    }
  }, [code])

  async function join(guide) {
    setJoinError(null)
    if (!canSaveTourPass()) {
      setJoinError(`This browser can't save it. Type ${guide.referral_code} at the stall's checkout instead.`)
      return
    }
    setJoining(true)
    try {
      const joined = await api(`/public/drivers/${encodeURIComponent(guide.referral_code)}/join`, { method: "POST" })
      saveTourPass(joined.referral_code, joined.first_name, joined.join_token)
      setPass(readTourPass())
    } catch (err) {
      setJoinError(err.message)
    } finally {
      setJoining(false)
    }
  }

  const guide = state.guide
  // A pass from before tours (no join token) doesn't count: the tourist joins again.
  const joinedHere = guide && pass?.code === guide.referral_code && pass.joinToken

  return (
    <Screen>
      <section aria-live="polite" className="mt-8 rounded-sawa border border-sawa-border bg-sawa-surface p-6">
        {state.status === "loading" && <p className="text-[15px] text-sawa-text-muted">Checking this guide…</p>}
        {state.status === "registered" && (
          <>
            <p className="text-[13px] text-sawa-text-muted">Registered Sawa Split guide</p>
            <h1
              className={`mt-1 inline-flex flex-wrap items-center gap-x-1.5 text-xl font-semibold ${guide.active ? "" : "text-sawa-text-muted"}`}
            >
              {guide.first_name} · {referrerType(guide.referrer_type)} ·{" "}
              {guide.active ? (
                <span className="inline-flex items-center gap-1 text-sawa-green">
                  <Check aria-hidden="true" className="size-5" /> Active
                </span>
              ) : (
                <span className="inline-flex items-center gap-1">
                  <Minus aria-hidden="true" className="size-5" /> Not active
                </span>
              )}
            </h1>

            {!guide.active && (
              <p className="mt-4 text-[15px] text-sawa-text-muted">
                {guide.first_name} can't take referrals right now. You can still pay at any stall; the maker gets it all.
              </p>
            )}

            {guide.active && (
              <>
                <p className="mt-4 text-[13px] text-sawa-text-muted">
                  Their referral share is disclosed at each stall's checkout before you pay.
                </p>
                {/* The tour pass (MUST 3, 17): joining is counted by Sawa Split, then this guide fills in at every stall today. */}
                <div className="mt-5 border-t border-sawa-border pt-4">
                  {joinedHere ? (
                    <>
                      <p className="flex items-center gap-2 text-[15px] font-semibold text-sawa-green">
                        <Check aria-hidden="true" className="size-4 shrink-0" /> {guide.first_name} is your guide today
                      </p>
                      <p className="mt-1 text-[13px] text-sawa-text-muted">
                        Each stall's checkout asks if you're still with {guide.first_name}, until midnight.
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          clearTourPass()
                          setPass(null)
                        }}
                        className="mt-2 text-sm text-sawa-text-muted underline-offset-2 hover:text-sawa-text hover:underline"
                      >
                        Stop using {guide.first_name} as my guide
                      </button>
                    </>
                  ) : guide.tour_running && !guide.tour_full ? (
                    <>
                      <SecondaryButton className="w-full" onClick={() => join(guide)} disabled={joining}>
                        {joining ? "Joining…" : `Use ${guide.first_name} as my guide today`}
                      </SecondaryButton>
                      {pass?.code && pass.code !== guide.referral_code && (
                        <p className="mt-2 text-[13px] text-sawa-text-muted">This replaces {pass.firstName || pass.code} as your guide.</p>
                      )}
                    </>
                  ) : (
                    <p className="text-[15px]">
                      {guide.tour_full ? `${guide.first_name}'s tour is full.` : `${guide.first_name} isn't running a tour right now.`}{" "}
                      <span className="text-sawa-text-muted">You can still pay at any stall; the maker gets it all.</span>
                    </p>
                  )}
                  <div className="mt-2">
                    <ErrorNote>{joinError}</ErrorNote>
                  </div>
                </div>
              </>
            )}
          </>
        )}
        {state.status === "unknown" && (
          <>
            <p className="flex items-center gap-2 text-[15px] font-semibold text-sawa-terracotta">
              <AlertTriangle aria-hidden="true" className="size-5 shrink-0" />
              This isn't a registered Sawa Split guide
            </p>
            <p className="mt-2 font-mono text-[13px] text-sawa-text-muted">{code}</p>
          </>
        )}
        {state.status === "error" && <ErrorNote>{state.message}</ErrorNote>}
      </section>
    </Screen>
  )
}
