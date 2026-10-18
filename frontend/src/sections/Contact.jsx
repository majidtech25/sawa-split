import { useState } from "react"
import { Copy, Mail, MapPin, MessageCircle } from "lucide-react"
import { LinkButton } from "../components/Button"

const EMAIL = "abdulshide87@gmail.com"
const WHATSAPP = "+254 740 957 721"
const WHATSAPP_LINK = "https://wa.me/254740957721"

// Plain, selectable text with a copy button: no form, and not a mailto-only link.
function Copyable({ icon: Icon, label, value, copyLabel }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // No clipboard access: the text is still there to select by hand.
    }
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-sawa border border-sawa-border bg-sawa-surface px-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <Icon size={20} strokeWidth={1.75} aria-hidden="true" className="shrink-0 text-sawa-green" />
        <div className="min-w-0">
          <div className="text-xs text-sawa-text-muted">{label}</div>
          <div className="select-all break-all font-mono text-[15px] text-sawa-text">{value}</div>
        </div>
      </div>
      <button
        type="button"
        onClick={copy}
        className="inline-flex min-h-11 items-center gap-1.5 text-sm text-sawa-green underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sawa-green"
      >
        <Copy aria-hidden="true" className="size-4" />
        {copied ? "Copied" : copyLabel}
      </button>
    </div>
  )
}

export default function Contact() {
  return (
    <section id="contact" className="scroll-mt-16 border-t border-sawa-border bg-sawa-surface px-6 py-16 md:py-20">
      <div className="mx-auto max-w-2xl">
        <h2 className="text-center text-xl font-semibold text-sawa-text">Bring Sawa Split to your market</h2>
        <p className="mt-3 text-center text-[15px] text-sawa-text-muted">
          For cooperatives, site coordinators and tourism offices. We'll set up your makers and guides in person, print
          their stall and guide QR codes, and run a pilot with you.
        </p>
        <div className="mt-8 flex flex-col gap-3">
          <Copyable icon={Mail} label="Email" value={EMAIL} copyLabel="Copy email" />
          <Copyable icon={MessageCircle} label="WhatsApp" value={WHATSAPP} copyLabel="Copy number" />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="flex items-center gap-2 text-sm text-sawa-text-muted">
              <MapPin size={18} strokeWidth={1.75} aria-hidden="true" className="shrink-0 text-sawa-green" />
              Or visit: Oasis Innovation Hub offices, Garissa University
            </p>
            <LinkButton href={WHATSAPP_LINK} external>
              <MessageCircle size={16} strokeWidth={1.75} aria-hidden="true" /> Chat on WhatsApp
            </LinkButton>
          </div>
        </div>

        {/* Quoted with the speaker's approval; wording exactly as approved. */}
        <figure className="mt-10 rounded-sawa border-l-4 border-sawa-green bg-sawa-bg px-5 py-5">
          <blockquote className="text-lg font-semibold leading-snug text-sawa-text">
            "Innovation is not about where you come from. It's about the problems you refuse to ignore."
          </blockquote>
          <figcaption className="mt-3 text-sm text-sawa-text-muted">— Abdiaziz Haredh, Chairman, Oasis Innovation Hub</figcaption>
        </figure>
        <p className="mt-4 text-center text-sm text-sawa-text-muted">
          With thanks to Oasis Innovation Hub for championing young innovators at Garissa University.
        </p>
      </div>
    </section>
  )
}
