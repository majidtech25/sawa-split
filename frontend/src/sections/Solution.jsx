import { Receipt, Split, Wallet } from "lucide-react"

const steps = [
  {
    icon: Receipt,
    label: "Disclosed price",
    description:
      "The tourist sees each priced component — product, photo consent, or both — before paying anything.",
  },
  {
    icon: Split,
    label: "Automatic split",
    description:
      "Payment splits the moment it's confirmed: the maker's share and the driver's referral fee, credited separately.",
  },
  {
    icon: Wallet,
    label: "Paid instantly",
    description:
      "Balances are available to withdraw as soon as they clear — no waiting on a driver to hand over cash.",
  },
]

export default function Solution() {
  return (
    <section className="px-6 py-16">
      <div className="mx-auto max-w-5xl">
        <h2 className="text-center text-xl font-semibold text-sawa-text">
          How it works
        </h2>
        <div className="mt-10 grid gap-8 md:grid-cols-3">
          {steps.map(({ icon: Icon, label, description }) => (
            <div key={label} className="text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-sawa border border-sawa-green text-sawa-green">
                <Icon size={22} strokeWidth={1.75} aria-hidden="true" />
              </div>
              <h3 className="mt-4 text-base font-semibold text-sawa-text">
                {label}
              </h3>
              <p className="mt-2 text-sm text-sawa-text-muted">
                {description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
