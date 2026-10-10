import { useEffect, useState } from "react"
import QRCode from "qrcode"
import { Check } from "lucide-react"
import { ErrorNote, Field, Screen, SecondaryButton } from "../components/ui"
import { api } from "../lib/api"
import { APP_URL } from "../lib/appUrl"
import { QR_OPTIONS } from "../lib/driverQr"
import { ksh } from "../lib/format"
import { supabase } from "../lib/supabase"

// M-Pesa charges whole shillings, so a price with cents is refused here and by the API.
function priceError(value) {
  if (!value) return null
  if (!/^\d+$/.test(value)) return "Whole shillings only, with no cents (for example 150, not 150.50)."
  return null
}

const selectClass =
  "rounded-sawa border border-sawa-border bg-sawa-surface px-3 py-2.5 text-[15px] text-sawa-text outline-none focus:border-2 focus:border-sawa-green"

// The coordinator makes each stall's price card here. The API signs the link, so a
// tourist who scans the printed QR sees prices nobody could have edited.
export default function PriceCardsPage() {
  const [producers, setProducers] = useState([])
  const [drivers, setDrivers] = useState([])
  const [producerId, setProducerId] = useState("")
  const [driverQr, setDriverQr] = useState("")
  const [product, setProduct] = useState("")
  const [photo, setPhoto] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [card, setCard] = useState(null)

  useEffect(() => {
    Promise.all([
      supabase.from("producers").select("id, name, site, charges_product, charges_photo, active").order("name"),
      supabase.from("drivers").select("name, qr_code, active").order("name"),
    ]).then(([p, d]) => {
      setProducers((p.data || []).filter((x) => x.active))
      setDrivers((d.data || []).filter((x) => x.active))
    })
  }, [])

  const producer = producers.find((p) => p.id === producerId)

  const [priceErrors, setPriceErrors] = useState({})

  async function generate(event) {
    event.preventDefault()
    setError(null)
    setCard(null)
    if (!producer) {
      setError("Choose the maker this card is for.")
      return
    }
    const errors = { product: priceError(product), photo: priceError(photo) }
    setPriceErrors(errors)
    if (errors.product || errors.photo) return
    setBusy(true)
    try {
      const result = await api("/admin/price-cards", {
        method: "POST",
        auth: true,
        body: {
          producer_id: producer.id,
          product_amount: producer.charges_product && product ? product : null,
          photo_amount: producer.charges_photo && photo ? photo : null,
          driver_qr: driverQr || null,
        },
      })
      const url = `${APP_URL}/#${result.path}`
      const qr = await QRCode.toDataURL(url, QR_OPTIONS)
      setCard({ url, qr, total: result.total_amount })
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen>
      <h1 className="text-2xl font-semibold">Price cards</h1>
      <p className="mt-1 text-[15px] text-sawa-text-muted">
        Make a signed link and QR for a stall. If its prices or driver change, make a new card.
      </p>

      <form onSubmit={generate} className="mt-6 flex flex-col gap-4" noValidate>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="card-producer" className="text-[13px] text-sawa-text-muted">Maker</label>
          <select id="card-producer" className={selectClass} value={producerId} onChange={(e) => setProducerId(e.target.value)}>
            <option value="">Choose a maker</option>
            {producers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.site ? ` · ${p.site}` : ""}
              </option>
            ))}
          </select>
        </div>
        {producer?.charges_product && (
          <Field id="card-product" label="Product price (KSh)" inputMode="numeric" value={product} onChange={(e) => setProduct(e.target.value.trim())} error={priceErrors.product} />
        )}
        {producer?.charges_photo && (
          <Field id="card-photo" label="Photo consent price (KSh)" inputMode="numeric" value={photo} onChange={(e) => setPhoto(e.target.value.trim())} error={priceErrors.photo} />
        )}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="card-driver" className="text-[13px] text-sawa-text-muted">Referring driver (optional)</label>
          <select id="card-driver" className={selectClass} value={driverQr} onChange={(e) => setDriverQr(e.target.value)}>
            <option value="">No driver: a walk-up card</option>
            {drivers.map((d) => (
              <option key={d.qr_code} value={d.qr_code}>
                {d.name} ({d.qr_code})
              </option>
            ))}
          </select>
        </div>
        <SecondaryButton type="submit" disabled={busy} className="mt-2 w-full">
          {busy ? "Signing…" : "Make price card"}
        </SecondaryButton>
        <ErrorNote>{error}</ErrorNote>
      </form>

      {card && (
        <section aria-live="polite" className="mt-6 flex flex-col items-center gap-3 rounded-sawa border border-sawa-border bg-sawa-surface p-4">
          <p className="flex items-center gap-2 self-start text-sm font-semibold text-sawa-green">
            <Check aria-hidden="true" className="size-4" /> Signed card, total {ksh(card.total)}
          </p>
          <img src={card.qr} alt="Price card QR code" className="size-48 rounded-sawa border border-sawa-border" />
          <a href={card.url} className="break-all font-mono text-xs text-sawa-green underline">
            {card.url}
          </a>
        </section>
      )}
    </Screen>
  )
}
