export default function SiteFooter() {
  return (
    <footer className="border-t border-sawa-border px-6 py-10">
      <div className="mx-auto flex max-w-5xl flex-col items-center gap-3 text-center text-sm text-sawa-text-muted">
        <p>Built for the Future Leaders Challenge Eastern Africa.</p>
        <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
          <span aria-disabled="true" className="cursor-not-allowed opacity-60">
            Live demo (coming soon)
          </span>
          <a
            href="https://github.com/majidtech25/sawa-split"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sawa-green hover:underline"
          >
            GitHub repo
          </a>
        </div>
        <p className="text-xs">
          Photo by{" "}
          <a
            href="https://unsplash.com/@spliff_dj_joe"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sawa-green hover:underline"
          >
            Dwayne joe
          </a>{" "}
          on{" "}
          <a
            href="https://unsplash.com/photos/dnhm5nzXGl4"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sawa-green hover:underline"
          >
            Unsplash
          </a>
          , Nairobi, Kenya.
        </p>
      </div>
    </footer>
  )
}
