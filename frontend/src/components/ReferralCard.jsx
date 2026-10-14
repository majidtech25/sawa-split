import { useEffect, useState } from "react"
import QRCode from "qrcode"
import { X } from "lucide-react"
import { SecondaryButton } from "./ui"
import { APP_URL } from "../lib/appUrl"
import { QR_OPTIONS } from "../lib/driverQr"

// A referrer's own code and QR on their dashboard (SCOPE_V2 MUST 2). Tourists scan it
// to see the referrer is registered and to keep them as their guide for the day.
export default function ReferralCard({ code }) {
  const [qr, setQr] = useState(null)
  const [full, setFull] = useState(false)
  const url = `${APP_URL}/#/driver/${encodeURIComponent(code)}`

  useEffect(() => {
    let live = true
    QRCode.toDataURL(url, { ...QR_OPTIONS, width: 720 }).then((image) => live && setQr(image))
    return () => {
      live = false
    }
  }, [url])

  return (
    <section aria-label="Your referral code" className="rounded-sawa border border-sawa-border bg-sawa-surface p-4">
      <p className="text-[13px] text-sawa-text-muted">Your referral code</p>
      <p className="font-mono text-3xl font-bold tracking-wider">{code}</p>
      <p className="mt-1 text-[13px] text-sawa-text-muted">
        Tourists scan your QR (or type the code at the stall) so your disclosed share comes to you.
      </p>
      <div className="mt-3 flex items-center gap-4">
        {qr && <img src={qr} alt={`QR code for referral code ${code}`} className="size-28 rounded-sawa border border-sawa-border" />}
        <SecondaryButton onClick={() => setFull(true)}>Show full screen</SecondaryButton>
      </div>
      {full && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Referral code ${code}`}
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-white p-6"
          onClick={() => setFull(false)}
        >
          {qr && <img src={qr} alt={`QR code for referral code ${code}`} className="w-full max-w-[min(90vw,90vh)]" />}
          <p className="font-mono text-4xl font-bold tracking-wider">{code}</p>
          <button
            type="button"
            onClick={() => setFull(false)}
            className="inline-flex items-center gap-2 text-sm text-sawa-text-muted hover:text-sawa-text"
          >
            <X aria-hidden="true" className="size-4" /> Close
          </button>
        </div>
      )}
    </section>
  )
}
