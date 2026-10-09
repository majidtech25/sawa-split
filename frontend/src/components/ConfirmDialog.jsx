import { useEffect, useRef, useState } from "react"
import { ErrorNote, SecondaryButton } from "./ui"

const focusRing =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sawa-green"

// Coordinator actions are modals off a table row, not their own screens (CLAUDE.md
// section 7). onConfirm may throw: its message is shown and the dialog stays open.
export default function ConfirmDialog({ open, title, children, confirmLabel, onConfirm, onClose }) {
  const ref = useRef(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  useEffect(() => {
    const dialog = ref.current
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  async function confirm() {
    setBusy(true)
    setError(null)
    try {
      await onConfirm()
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      className="m-auto w-[min(420px,calc(100vw-32px))] rounded-sawa border border-sawa-border bg-sawa-surface p-5 text-sawa-text backdrop:bg-black/30"
    >
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="mt-2 text-[15px] text-sawa-text-muted">{children}</div>
      <div className="mt-3">
        <ErrorNote>{error}</ErrorNote>
      </div>
      <div className="mt-5 flex justify-end gap-3">
        <button type="button" onClick={onClose} className={`px-3 py-2 text-sm text-sawa-text-muted hover:text-sawa-text ${focusRing}`}>
          Cancel
        </button>
        <SecondaryButton onClick={confirm} disabled={busy}>
          {busy ? "Working…" : confirmLabel}
        </SecondaryButton>
      </div>
    </dialog>
  )
}
