import { useEffect, useState } from "react"
import { useParams } from "react-router-dom"
import Brand from "../components/Brand"
import QRCode from "qrcode"
import { ErrorNote } from "../components/ui"
import { api } from "../lib/api"
import { APP_URL } from "../lib/appUrl"
import { QR_OPTIONS } from "../lib/driverQr"

// The maker's stand QR, for printing (SCOPE_V2 MUST 5). One static QR per maker: it
// opens /#/stall/<stall code>, which shows whatever sale the maker has just entered.
export default function StandPage() {
  const { code } = useParams()
  const [stall, setStall] = useState(null)
  const [qr, setQr] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let live = true
    api(`/public/stalls/${encodeURIComponent(code)}`)
      .then(async (s) => {
        const image = await QRCode.toDataURL(`${APP_URL}/#/stall/${encodeURIComponent(s.stall_code)}`, { ...QR_OPTIONS, width: 720 })
        if (!live) return
        setStall(s)
        setQr(image)
      })
      .catch((err) => live && setError(err.message))
    return () => {
      live = false
    }
  }, [code])

  if (error) return <main className="mx-auto max-w-[420px] px-4 py-8"><ErrorNote>{error}</ErrorNote></main>
  if (!stall || !qr) return <main className="mx-auto max-w-[420px] px-4 py-8 text-sm text-sawa-text-muted">Loading…</main>

  // The printable stand keeps its original near-white page, not the site's sand background.
  return (
    <div className="min-h-screen bg-[#fafaf8]">
      <main className="mx-auto flex min-h-screen max-w-[520px] flex-col items-center justify-center gap-5 px-4 py-10 text-center">
        <Brand className="text-base" />
        <h1 className="text-3xl font-semibold">{stall.maker.name}</h1>
        {stall.site && <p className="text-lg text-sawa-text-muted">{stall.site}</p>}
        <img src={qr} alt={`QR code for ${stall.maker.name}'s stall`} className="w-full max-w-[360px] rounded-sawa border border-sawa-border" />
        <p className="text-xl font-semibold">Scan to pay</p>
        <p className="max-w-[360px] text-[15px] text-sawa-text-muted">
          See exactly where every shilling goes before you pay: to the creator, and to your site intermediary if you have one. Nothing to
          Sawa Split.
        </p>
        <p className="font-mono text-sm text-sawa-text-muted">Stall {stall.stall_code}</p>
        <button
          type="button"
          onClick={() => window.print()}
          className="rounded-sawa border border-sawa-green px-4 py-2.5 text-sm font-semibold text-sawa-green hover:bg-sawa-green hover:text-white print:hidden"
        >
          Print this stand
        </button>
      </main>
    </div>
  )
}
