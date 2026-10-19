import { useEffect, useRef, useState } from "react"
import { Link, NavLink, useNavigate } from "react-router-dom"
import { ClipboardList, LogOut, Menu, QrCode, Scale, UserPlus, X } from "lucide-react"
import Brand from "./Brand"
import { endSession } from "../lib/supabase"

const PAGES = [
  { to: "/coordinator", label: "Reconciliation", icon: Scale, end: true },
  { to: "/coordinator/register", label: "Register", icon: UserPlus },
  { to: "/coordinator/price-cards", label: "Price cards", icon: QrCode },
  { to: "/coordinator/accounts", label: "Accounts", icon: ClipboardList },
]

const focusRing =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sawa-green"

// The current page: a green tint, a green bar on its left and bold text.
const pageLink = ({ isActive }) =>
  `flex min-h-11 items-center gap-3 rounded-sawa border-l-4 px-3 text-sm transition-colors duration-150 ${focusRing} ${
    isActive
      ? "border-sawa-green bg-sawa-green/10 font-semibold text-sawa-green"
      : "border-transparent text-sawa-text hover:bg-sawa-bg hover:text-sawa-green"
  }`

function PageLinks({ onPick }) {
  return (
    <ul className="flex flex-col gap-1">
      {PAGES.map(({ to, label, icon: Icon, end }) => (
        <li key={to}>
          <NavLink to={to} end={end} className={pageLink} onClick={onPick}>
            <Icon aria-hidden="true" className="size-4 shrink-0" />
            {label}
          </NavLink>
        </li>
      ))}
    </ul>
  )
}

// The coordinator's frame: a left sidebar on wide screens (logo on top, the four pages,
// Log out at the bottom); on phones a top bar with a Menu holding the same.
export default function CoordinatorShell({ children }) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const barRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => e.key === "Escape" && setOpen(false)
    const onPointer = (e) => barRef.current && !barRef.current.contains(e.target) && setOpen(false)
    document.addEventListener("keydown", onKey)
    document.addEventListener("pointerdown", onPointer)
    return () => {
      document.removeEventListener("keydown", onKey)
      document.removeEventListener("pointerdown", onPointer)
    }
  }, [open])

  async function logOut() {
    await endSession()
    navigate("/login", { replace: true })
  }
  const logOutButton = (
    <button
      type="button"
      onClick={logOut}
      className={`flex min-h-11 w-full items-center gap-3 rounded-sawa px-3 text-sm text-sawa-text-muted transition-colors duration-150 hover:bg-sawa-bg hover:text-sawa-text ${focusRing}`}
    >
      <LogOut aria-hidden="true" className="size-4 shrink-0" />
      Log out
    </button>
  )

  return (
    <div className="min-h-screen lg:flex">
      {/* Wide screens: the sidebar. */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-sawa-border bg-sawa-surface px-3 py-4 lg:flex">
        <Link to="/" className={`inline-flex min-h-11 items-center px-3 text-base ${focusRing}`}>
          <Brand />
        </Link>
        <nav aria-label="Coordinator" className="mt-6 flex-1">
          <PageLinks />
        </nav>
        {logOutButton}
      </aside>

      {/* Phones and tablets: a top bar with the same pages in a Menu. */}
      <header ref={barRef} className="sticky top-0 z-30 border-b border-sawa-border bg-sawa-surface lg:hidden">
        <div className="flex items-center justify-between gap-4 px-4 py-1.5">
          <Link to="/" className={`inline-flex min-h-11 items-center text-base ${focusRing}`}>
            <Brand />
          </Link>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-controls="coordinator-menu"
            className={`inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap text-sm text-sawa-text ${focusRing}`}
          >
            {open ? <X aria-hidden="true" className="size-5" /> : <Menu aria-hidden="true" className="size-5" />}
            Menu
          </button>
        </div>
        {open && (
          <nav id="coordinator-menu" aria-label="Coordinator" className="border-t border-sawa-border px-3 py-2">
            <PageLinks onPick={() => setOpen(false)} />
            <div className="mt-1 border-t border-sawa-border pt-1">{logOutButton}</div>
          </nav>
        )}
      </header>

      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}
