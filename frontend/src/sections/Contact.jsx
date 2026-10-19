import { useState } from "react"
import { Copy, Mail, MapPin, MessageCircle } from "lucide-react"
import { LinkButton } from "../components/Button"
import Section, { SectionHeading } from "../components/Section"

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

// The office card's "map" is drawn with CSS only (a street-grid pattern and a pin): purely
// decorative, with no map service, tiles or any other third-party request.
const STREET_GRID = {
  backgroundColor: "#F3EEE2",
  backgroundImage:
    "linear-gradient(90deg, rgba(30,91,58,0.10) 1px, transparent 1px), linear-gradient(0deg, rgba(30,91,58,0.10) 1px, transparent 1px), linear-gradient(35deg, transparent 47%, rgba(185,122,34,0.28) 47%, rgba(185,122,34,0.28) 53%, transparent 53%)",
  backgroundSize: "28px 28px, 28px 28px, 100% 100%",
}

export default function Contact() {
  return (
    <Section id="contact" className="border-t border-sawa-border bg-sawa-surface">
      <div className="grid gap-10 lg:grid-cols-2 lg:items-start lg:gap-16">
        <div>
          <SectionHeading eyebrow="Contact" title="Bring Sawa Split to your market" />
          <p className="mt-3 max-w-xl text-[15px] text-sawa-text-muted">
            For cooperatives, site coordinators and tourism offices. We'll set up your makers and guides in person, print
            their stall and guide QR codes, and run a pilot with you.
          </p>
          <div className="mt-8 flex max-w-xl flex-col gap-3">
            <Copyable icon={Mail} label="Email" value={EMAIL} copyLabel="Copy email" />
            <Copyable icon={MessageCircle} label="WhatsApp" value={WHATSAPP} copyLabel="Copy number" />
            <div>
              <LinkButton href={WHATSAPP_LINK} external>
                <MessageCircle size={16} strokeWidth={1.75} aria-hidden="true" /> Chat on WhatsApp
              </LinkButton>
            </div>
          </div>
        </div>

        <div className="overflow-hidden rounded-sawa border border-sawa-border bg-sawa-surface">
          <div aria-hidden="true" className="relative h-48" style={STREET_GRID}>
            <MapPin size={36} strokeWidth={1.75} className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-full fill-white text-sawa-green" />
          </div>
          <div className="flex items-start gap-3 p-5">
            <MapPin size={20} strokeWidth={1.75} aria-hidden="true" className="mt-0.5 shrink-0 text-sawa-green" />
            <div>
              <h3 className="text-sm font-semibold text-sawa-text">Visit us</h3>
              <p className="mt-1 text-sm text-sawa-text-muted">Oasis Innovation Hub offices, Garissa University</p>
            </div>
          </div>
        </div>
      </div>
    </Section>
  )
}
