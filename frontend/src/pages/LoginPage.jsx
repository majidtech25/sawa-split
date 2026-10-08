import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { ErrorNote, Field, Screen, SecondaryButton } from "../components/ui"
import { api } from "../lib/api"
import { startSession } from "../lib/supabase"

// One login for producers, drivers and the coordinator (phone + 4-digit PIN);
// what loads afterwards depends on who signed in.
export default function LoginPage() {
  const navigate = useNavigate()
  const [phone, setPhone] = useState("")
  const [pin, setPin] = useState("")
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  async function submit(event) {
    event.preventDefault()
    setError(null)
    if (!/^\d{4}$/.test(pin)) {
      setError("Your PIN is the 4 digits your coordinator gave you.")
      return
    }
    setBusy(true)
    try {
      const normalized = phone.replace(/[\s-]/g, "").replace(/^0/, "+254").replace(/^254/, "+254")
      const login = await api("/auth/login", { method: "POST", body: { phone: normalized, pin } })
      const profile = await startSession(login)
      navigate(profile.role === "coordinator" ? "/coordinator" : "/dashboard", { replace: true })
    } catch (err) {
      setError(err.status === 401 ? "That phone number and PIN don't match. Check both and try again." : err.message)
      setBusy(false)
    }
  }

  return (
    <Screen className="flex min-h-[70vh] flex-col justify-center">
      <h1 className="text-2xl font-semibold">Log in</h1>
      <p className="mt-1 text-[15px] text-sawa-text-muted">With the phone number and PIN from your coordinator.</p>
      <form onSubmit={submit} className="mt-6 flex flex-col gap-4" noValidate>
        <Field
          id="login-phone"
          label="Phone number"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="07XX XXX XXX"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
        <Field
          id="login-pin"
          label="PIN"
          type="password"
          inputMode="numeric"
          autoComplete="current-password"
          maxLength={4}
          placeholder="••••"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
        />
        <SecondaryButton type="submit" disabled={busy} className="mt-2 w-full">
          {busy ? "Logging in…" : "Log in"}
        </SecondaryButton>
        <ErrorNote>{error}</ErrorNote>
      </form>
      <p className="mt-8 text-center text-[13px] text-sawa-text-muted">
        Makers and drivers are registered by your site coordinator. Ask them for your login.
      </p>
    </Screen>
  )
}
