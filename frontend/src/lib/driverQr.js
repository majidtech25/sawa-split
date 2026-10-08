// A driver's QR card opens their public verification page (#/driver/<code>) when
// scanned with any phone camera. Plain module (no import.meta.env) so the
// regenerate script in scripts/ builds exactly the same QR as the Register screen.

export const QR_OPTIONS = { width: 480, margin: 2, color: { dark: "#1A1A1A", light: "#FFFFFF" } }

export const driverQrUrl = (appUrl, code) => `${appUrl.replace(/\/$/, "")}/#/driver/${encodeURIComponent(code)}`

export const driverQrFile = (code) => `${code}.png`
