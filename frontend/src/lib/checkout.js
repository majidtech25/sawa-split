import { useEffect, useState } from "react"
import { api } from "./api"

// The printed card's QR carries the stall and its prices: #/pay/<producerId>?product=100&photo=10&driver=<QR code>&sig=<signature>.
export function checkoutQuery(search) {
  const q = new URLSearchParams()
  for (const key of ["product", "photo"]) if (search.get(key)) q.set(key, search.get(key))
  if (search.get("driver")) q.set("driver_qr", search.get("driver"))
  // The API signs each card's link so its prices and driver can't be edited.
  if (search.get("sig")) q.set("sig", search.get("sig"))
  return q.toString()
}

export function useCheckout(producerId, search) {
  const query = checkoutQuery(search)
  const key = `${producerId}?${query}`
  const [result, setResult] = useState({ key: null, checkout: null, error: null })
  useEffect(() => {
    let live = true
    api(`/public/checkout/${encodeURIComponent(producerId)}?${query}`)
      .then((checkout) => live && setResult({ key, checkout, error: null }))
      .catch((error) => live && setResult({ key, checkout: null, error: error.message }))
    return () => {
      live = false
    }
  }, [producerId, query, key])
  // A result for a different stall or price is stale: show loading until this one arrives.
  if (result.key !== key) return { loading: true, checkout: null, error: null }
  return { loading: false, checkout: result.checkout, error: result.error }
}

// Shapes the API's checkout (or a receipt) into PriceTransparencyCard's props: one
// card per component, never merged (CLAUDE.md rule 1), photo never split (rule 2).
// A service includes photography in its price (SCOPE_V2 MUST 15): no photo line, a note
// instead, and the whole price splits as usual. With the fixed split (migration 0020) the
// product also shows the Conservation fund's 5%, computed by the server like every share.
export const FUND_NOTE = "Ring-fenced for a partner community conservancy — reported publicly."

export function cardProps({ site, producerName, driverName, product, photo, total, service = false }) {
  const components = []
  if (product) {
    const fund = Number(product.fund_amount || 0)
    const notes = [service ? "Photography included" : null, fund > 0 ? FUND_NOTE : null].filter(Boolean)
    components.push({
      key: "product",
      label: service ? "Service" : "Product",
      amount: product.amount,
      note: notes.length ? notes.join(" ") : null,
      breakdown: [
        { label: `Creator · ${producerName}`, amount: product.maker_amount ?? product.amount, highlight: true },
        ...(driverName ? [{ label: `Intermediary · ${driverName}`, amount: product.driver_amount }] : []),
        ...(fund > 0 ? [{ label: "Conservation fund (5%)", amount: product.fund_amount }] : []),
      ],
    })
  }
  if (photo) {
    components.push({
      key: "photo",
      label: "Photo consent",
      amount: photo.amount,
      breakdown: [{ label: "Creator — not split", amount: photo.amount, highlight: true }],
    })
  }
  return { site: [site, producerName].filter(Boolean).join(" · "), components, total }
}

export function cardFromCheckout(c) {
  return cardProps({
    site: c.site,
    producerName: c.producer.name,
    driverName: c.driver?.name,
    product: c.product,
    photo: c.photo,
    total: c.total_amount,
    service: c.business_type === "service",
  })
}
