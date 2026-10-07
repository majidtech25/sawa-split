import { useEffect, useState } from "react"
import { api } from "./api"

// The printed card's QR carries the stall and its prices: #/pay/<producerId>?product=100&photo=10&driver=<QR code>.
export function checkoutQuery(search) {
  const q = new URLSearchParams()
  for (const key of ["product", "photo"]) if (search.get(key)) q.set(key, search.get(key))
  if (search.get("driver")) q.set("driver_qr", search.get("driver"))
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
export function cardProps({ site, producerName, driverName, product, photo, total }) {
  const components = []
  if (product) {
    components.push({
      key: "product",
      label: "Product",
      amount: product.amount,
      breakdown: driverName
        ? [
            { label: `Maker · ${producerName}`, amount: product.maker_amount, highlight: true },
            { label: `Driver referral · ${driverName}`, amount: product.driver_amount },
          ]
        : [{ label: `Maker · ${producerName}`, amount: product.amount, highlight: true }],
    })
  }
  if (photo) {
    components.push({
      key: "photo",
      label: "Photo consent",
      amount: photo.amount,
      breakdown: [{ label: "Maker — not split", amount: photo.amount, highlight: true }],
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
  })
}
