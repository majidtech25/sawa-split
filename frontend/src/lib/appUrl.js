// The frontend's public URL, for anything printed (driver QR cards, price cards).
// Set VITE_PUBLIC_APP_URL to the Render URL in Stage 9 so a card printed from a
// laptop on localhost still opens the deployed app. Unset, it's this page's own URL.
export const APP_URL = (
  import.meta.env.VITE_PUBLIC_APP_URL || `${window.location.origin}${window.location.pathname}`
).replace(/\/$/, "")
