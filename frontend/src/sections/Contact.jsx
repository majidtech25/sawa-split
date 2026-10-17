import { useState } from "react"
import { Copy, Mail } from "lucide-react"

const EMAIL = "abdulshide87@gmail.com"

// Plain, selectable text with a copy button: no form, and not a mailto-only link.
function Copyable({ icon: Icon, label, value }) {
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
        {copied ? "Copied" : `Copy ${label.toLowerCase()}`}
      </button>
    </div>
  )
}

export default function Contact() {
  return (
    <section id="contact" className="scroll-mt-4 border-t border-sawa-border bg-sawa-surface px-6 py-16 md:py-20">
      <div className="mx-auto max-w-2xl">
        <h2 className="text-center text-xl font-semibold text-sawa-text">Bring Sawa Split to your market</h2>
        <p className="mt-3 text-center text-[15px] text-sawa-text-muted">
          For cooperatives, site coordinators and tourism offices. We'll set up your makers and guides in person, print
          their stall and guide QR codes, and run a pilot with you.
        </p>
        <div className="mt-8 flex flex-col gap-3">
          <Copyable icon={Mail} label="Email" value={EMAIL} />
        </div>
      </div>
    </section>
  )
}
