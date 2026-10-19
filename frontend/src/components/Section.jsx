// The homepage's one section frame: the same 1200px container, side padding and vertical
// spacing everywhere, with headings and text left-aligned (polish round 3).
export default function Section({ id, className = "", children }) {
  return (
    <section id={id} className={`scroll-mt-16 py-16 md:py-24 ${className}`}>
      <div className="mx-auto max-w-[1200px] px-6 lg:px-8">{children}</div>
    </section>
  )
}

export function SectionHeading({ eyebrow, title, onDark = false, className = "" }) {
  return (
    <div className={className}>
      {eyebrow && (
        <p className={`text-sm font-semibold uppercase tracking-wide ${onDark ? "text-white/85" : "text-sawa-green"}`}>{eyebrow}</p>
      )}
      <h2 className={`mt-2 text-2xl font-semibold leading-tight md:text-3xl ${onDark ? "text-white" : "text-sawa-text"}`}>{title}</h2>
    </div>
  )
}
