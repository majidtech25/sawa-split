// The homepage's one page width: up to 1440px, left-aligned (not centred), with the header's
// side padding (24px on phones, 48px on wide screens), so content lines up with the logo.
export const PAGE_WIDTH = "w-full max-w-[1440px] px-6 lg:px-12"

// The homepage's one section frame: that width, the same vertical spacing everywhere, with
// headings and text left-aligned.
export default function Section({ id, className = "", children }) {
  return (
    <section id={id} className={`scroll-mt-16 py-16 md:py-24 ${className}`}>
      <div className={PAGE_WIDTH}>{children}</div>
    </section>
  )
}

export function SectionHeading({ eyebrow, title, onDark = false, className = "" }) {
  return (
    <div className={className}>
      {eyebrow && (
        <p className={`text-sm font-semibold uppercase tracking-wide ${onDark ? "text-white" : "text-sawa-green"}`}>{eyebrow}</p>
      )}
      <h2 className={`mt-2 text-2xl font-semibold leading-tight md:text-3xl ${onDark ? "text-white" : "text-sawa-text"}`}>{title}</h2>
    </div>
  )
}
