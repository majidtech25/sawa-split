// Re-renders every driver's QR card image in the qr-codes bucket, so each one opens
// <app URL>/#/driver/<code>. Run again whenever the app URL changes (Stage 9: the
// Render URL). Overwrites only <code>.png files; never deletes anything.
//
//   cd frontend
//   node --env-file=.env --env-file=../backend/.env scripts/regenerate-driver-qrs.mjs [--app-url https://…]
//
// Needs VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (the backend's Secret key: the
// bucket is coordinator-only write) and the app URL, from --app-url or VITE_PUBLIC_APP_URL.
import QRCode from "qrcode"
import { QR_OPTIONS, driverQrFile, driverQrUrl } from "../src/lib/driverQr.js"

const flag = process.argv.indexOf("--app-url")
const appUrl = flag > -1 ? process.argv[flag + 1] : process.env.VITE_PUBLIC_APP_URL
const { VITE_SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: key } = process.env
if (!appUrl || !url || !key) {
  console.error("Missing the app URL (--app-url or VITE_PUBLIC_APP_URL), VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.")
  process.exit(1)
}

// Plain REST/Storage calls rather than supabase-js, whose realtime client needs a
// WebSocket package on Node 20.
const base = new URL(url).origin
const headers = { apikey: key, Authorization: `Bearer ${key}` }
const response = await fetch(`${base}/rest/v1/drivers?select=name,qr_code&order=created_at`, { headers })
if (!response.ok) throw new Error(`Couldn't list drivers: HTTP ${response.status} ${await response.text()}`)
const drivers = await response.json()

let failed = 0
for (const { name, qr_code: code } of drivers) {
  const target = driverQrUrl(appUrl, code)
  const png = await QRCode.toBuffer(target, QR_OPTIONS)
  const upload = await fetch(`${base}/storage/v1/object/qr-codes/${encodeURIComponent(driverQrFile(code))}`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "image/png", "x-upsert": "true" },
    body: png,
  })
  if (!upload.ok) failed += 1
  console.log(`${upload.ok ? "ok    " : "FAILED"} ${code} (${name}) -> ${target}${upload.ok ? "" : `: ${await upload.text()}`}`)
}
process.exit(failed ? 1 : 0)
