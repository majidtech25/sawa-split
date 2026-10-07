import { useState } from "react"
import QRCode from "qrcode"
import { Check } from "lucide-react"
import { ErrorNote, Field, Screen, SecondaryButton } from "../components/ui"
import { api } from "../lib/api"
import { supabase } from "../lib/supabase"

const focusRing =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sawa-green"

function newQrCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789" // no 0/O or 1/I to misread off a laminated card
  const bytes = crypto.getRandomValues(new Uint8Array(6))
  return `SAWA-DRV-${Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("")}`
}

function normalizePhone(phone) {
  return phone.replace(/[\s-]/g, "").replace(/^0/, "+254").replace(/^254/, "+254")
}

function Checkbox({ id, checked, onChange, children }) {
  return (
    <label htmlFor={id} className="flex items-center gap-3 text-[15px]">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className={`size-[18px] accent-sawa-green ${focusRing}`}
      />
      {children}
    </label>
  )
}

const EMPTY = { name: "", phone: "", till: "", pin: "", site: "", split: "30", product: true, photo: false }

export default function RegisterPage() {
  const [role, setRole] = useState("producer")
  const [form, setForm] = useState(EMPTY)
  const [qrCode, setQrCode] = useState(newQrCode)
  const [errors, setErrors] = useState({})
  const [submitError, setSubmitError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(null)
  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }))

  function validate() {
    const e = {}
    if (!form.name.trim()) e.name = "Enter their full name."
    if (!/^(\+?254|0)[17]\d{8}$/.test(form.phone.replace(/[\s-]/g, ""))) e.phone = "Enter a Safaricom number, like 0712 345 678."
    if (!form.till.trim()) e.till = "Enter the M-Pesa Till number."
    if (!/^\d{4}$/.test(form.pin)) e.pin = "Choose a 4-digit PIN to hand over in person."
    if (role === "producer") {
      const split = Number(form.split)
      if (form.split === "" || Number.isNaN(split) || split < 0 || split > 40)
        e.split = "Between 0 and 40. The maker always keeps at least 60% of the product price."
      if (!form.product && !form.photo) e.charges = "Pick at least one: product, photo consent, or both."
    }
    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function submit(event) {
    event.preventDefault()
    setSubmitError(null)
    if (!validate()) return
    setBusy(true)
    const base = { role, name: form.name.trim(), phone: normalizePhone(form.phone), till: form.till.trim(), pin: form.pin }
    const body =
      role === "producer"
        ? {
            ...base,
            site: form.site.trim() || null,
            default_split_driver_pct: Number(form.split),
            charges_product: form.product,
            charges_photo: form.photo,
          }
        : { ...base, qr_code: qrCode }
    try {
      const created = await api("/auth/onboard", { method: "POST", auth: true, body })
      let qrImage = null
      let qrStored = null
      if (role === "driver") {
        // The QR encodes the driver's code; it's stored in the qr-codes bucket
        // (public read, coordinator-only write) for printing and laminating.
        qrImage = await QRCode.toDataURL(qrCode, { width: 480, margin: 2, color: { dark: "#1A1A1A", light: "#FFFFFF" } })
        const blob = await (await fetch(qrImage)).blob()
        const { error } = await supabase.storage.from("qr-codes").upload(`${qrCode}.png`, blob, { contentType: "image/png", upsert: true })
        qrStored = error ? null : supabase.storage.from("qr-codes").getPublicUrl(`${qrCode}.png`).data.publicUrl
      }
      setDone({ role, id: created.id, name: base.name, qrCode: role === "driver" ? qrCode : null, qrImage, qrStored })
      setForm(EMPTY)
      setQrCode(newQrCode())
    } catch (err) {
      setSubmitError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const tab = (value, label) => (
    <button
      type="button"
      role="tab"
      aria-selected={role === value}
      onClick={() => {
        setRole(value)
        setErrors({})
        setDone(null)
      }}
      className={`flex-1 py-2.5 text-sm font-semibold ${focusRing} ${role === value ? "bg-sawa-green text-white" : "text-sawa-text-muted hover:text-sawa-text"}`}
    >
      {label}
    </button>
  )

  return (
    <Screen>
      <h1 className="text-2xl font-semibold">Register someone</h1>
      <p className="mt-1 text-[15px] text-sawa-text-muted">In person: they leave with their PIN{role === "driver" ? " and QR card" : ""}.</p>

      <div role="tablist" aria-label="Who are you registering" className="mt-5 flex overflow-hidden rounded-sawa border border-sawa-border bg-sawa-surface">
        {tab("producer", "New maker")}
        {tab("driver", "New driver")}
      </div>

      {done && (
        <section aria-live="polite" className="mt-5 rounded-sawa border border-sawa-border bg-sawa-surface p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-sawa-green">
            <Check aria-hidden="true" className="size-4" /> {done.name} is registered
          </p>
          {done.role === "producer" && (
            <p className="mt-2 text-[13px] text-sawa-text-muted">
              Their price card link:{" "}
              <code className="break-all font-mono text-sawa-text">#/pay/{done.id}?product=PRICE&amp;photo=PRICE</code>
            </p>
          )}
          {done.qrImage && (
            <div className="mt-3 flex flex-col items-center gap-2">
              <img src={done.qrImage} alt={`QR code ${done.qrCode}`} className="size-48 rounded-sawa border border-sawa-border" />
              <p className="font-mono text-sm">{done.qrCode}</p>
              {done.qrStored ? (
                <a href={done.qrStored} target="_blank" rel="noreferrer" className={`text-sm text-sawa-green underline ${focusRing}`}>
                  Open the QR to print
                </a>
              ) : (
                <p className="text-xs text-sawa-terracotta">The QR wasn't saved to storage. Print it from this screen instead.</p>
              )}
            </div>
          )}
        </section>
      )}

      <form onSubmit={submit} className="mt-5 flex flex-col gap-4" noValidate>
        <Field id="reg-name" label="Full name" value={form.name} onChange={(e) => set("name")(e.target.value)} error={errors.name} autoComplete="off" />
        <Field id="reg-phone" label="Phone number" type="tel" inputMode="tel" placeholder="07XX XXX XXX" value={form.phone} onChange={(e) => set("phone")(e.target.value)} error={errors.phone} />
        <Field id="reg-till" label="M-Pesa Till number" inputMode="numeric" value={form.till} onChange={(e) => set("till")(e.target.value)} error={errors.till} />
        <Field
          id="reg-pin"
          label="4-digit PIN"
          inputMode="numeric"
          maxLength={4}
          value={form.pin}
          onChange={(e) => set("pin")(e.target.value.replace(/\D/g, ""))}
          error={errors.pin}
          hint="Tell them in person. It isn't shown again."
        />

        {role === "producer" ? (
          <>
            <Field id="reg-site" label="Site (optional)" placeholder="e.g. Talek gate" value={form.site} onChange={(e) => set("site")(e.target.value)} />
            <Field
              id="reg-split"
              label="Driver referral (% of the product price)"
              inputMode="numeric"
              value={form.split}
              onChange={(e) => set("split")(e.target.value.replace(/[^\d.]/g, ""))}
              error={errors.split}
              hint="At most 40%. The maker keeps at least 60% of the product price, and all of photo consent."
            />
            <fieldset className="flex flex-col gap-2 border-t border-sawa-border pt-4">
              <legend className="text-[13px] text-sawa-text-muted">Charges for</legend>
              <Checkbox id="reg-product" checked={form.product} onChange={set("product")}>
                Product or service
              </Checkbox>
              <Checkbox id="reg-photo" checked={form.photo} onChange={set("photo")}>
                Photo consent
              </Checkbox>
              <p className={`text-xs ${errors.charges ? "text-sawa-terracotta" : "text-sawa-text-muted"}`}>
                {errors.charges || "Each is priced separately. Switch on one or both."}
              </p>
            </fieldset>
          </>
        ) : (
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] text-sawa-text-muted">QR code</span>
            <div className="flex items-center justify-between gap-3 rounded-sawa border border-sawa-border bg-sawa-surface px-3 py-2.5">
              <span className="font-mono text-[15px]">{qrCode}</span>
              <button type="button" onClick={() => setQrCode(newQrCode())} className={`text-sm text-sawa-green underline ${focusRing}`}>
                New code
              </button>
            </div>
            <p className="text-xs text-sawa-text-muted">Printed on their QR card; it identifies them as the referring driver.</p>
          </div>
        )}

        <SecondaryButton type="submit" disabled={busy} className="mt-2 w-full">
          {busy ? "Registering…" : role === "producer" ? "Register maker" : "Register driver"}
        </SecondaryButton>
        <ErrorNote>{submitError}</ErrorNote>
      </form>
    </Screen>
  )
}
