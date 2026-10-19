import { useEffect, useRef, useState } from "react"
import { HashRouter, Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom"
import Home from "./pages/Home"
import LoginPage from "./pages/LoginPage"
import { CheckoutPage, PriceCardPage } from "./pages/PayPage"
import DriverPage from "./pages/DriverPage"
import StallPage from "./pages/StallPage"
import DemoPage from "./pages/DemoPage"
import StandPage from "./pages/StandPage"
import DashboardPage from "./pages/DashboardPage"
import ReceiptPage from "./pages/ReceiptPage"
import AccountsPage from "./pages/AccountsPage"
import CoordinatorPage from "./pages/CoordinatorPage"
import PriceCardsPage from "./pages/PriceCardsPage"
import RegisterPage from "./pages/RegisterPage"
import { Menu, ShieldCheck, X } from "lucide-react"
import Brand from "./components/Brand"
import CoordinatorShell from "./components/CoordinatorShell"
import { currentProfile, endSession, forgetProfile, supabase } from "./lib/supabase"

const focusRing =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sawa-green"

const ROLE_HOME = {
  coordinator: { to: "/coordinator", label: "Reconciliation" },
  producer: { to: "/dashboard", label: "Dashboard" },
  driver: { to: "/dashboard", label: "Dashboard" },
}

const navLink = ({ isActive }) =>
  `inline-flex min-h-11 items-center whitespace-nowrap ${focusRing} ${isActive ? "font-semibold text-sawa-text" : "text-sawa-green hover:underline"}`

// The signed-in profile, only while Supabase holds a live session (SCOPE_V2 MUST 14):
// a missing or expired token (one that can't be refreshed) means logged out, and the
// stale profile is dropped. `checked` is false until Supabase has answered.
function useSession() {
  const [state, setState] = useState({ checked: false, profile: null })
  useEffect(() => {
    let live = true
    const apply = (session) => {
      const valid = Boolean(session && session.expires_at * 1000 > Date.now())
      if (!valid) forgetProfile()
      if (live) setState({ checked: true, profile: valid ? currentProfile() : null })
    }
    supabase.auth.getSession().then(({ data }) => apply(data.session))
    const { data } = supabase.auth.onAuthStateChange((_event, session) => apply(session))
    return () => {
      live = false
      data.subscription.unsubscribe()
    }
  }, [])
  return state
}

// The homepage sections the header links to (SCOPE: navbar polish, 2026-10-18).
const SECTIONS = [
  { id: "problem", label: "Problem" },
  { id: "how-it-works", label: "How it works" },
  { id: "who-its-for", label: "Who it's for" },
  { id: "roadmap", label: "Roadmap" },
  { id: "contact", label: "Contact" },
]

// The homepage section on screen, for highlighting its link. Only on the homepage.
function useCurrentSection(active) {
  const [current, setCurrent] = useState(null)
  useEffect(() => {
    if (!active) return undefined
    const pick = () => {
      // The last section whose top has passed just below the header.
      let found = null
      for (const { id } of SECTIONS) {
        const el = document.getElementById(id)
        if (el && el.getBoundingClientRect().top <= 120) found = id
      }
      setCurrent(found)
    }
    pick()
    window.addEventListener("scroll", pick, { passive: true })
    return () => window.removeEventListener("scroll", pick)
  }, [active])
  return active ? current : null
}

// Signed in: the role's home link and "Log out". Signed
// out: "Log in". There's no sign-up link: accounts are created by a coordinator.
// On the homepage it also has the section links: in the middle on wide screens, in a
// "Menu" on phones. Every other page has just the logo and auth. Tourist pages show
// only the logo and "Verified checkout" (MUST 18d); coordinator pages have their own
// sidebar instead (components/CoordinatorShell.jsx).
function AppHeader({ tourist = false }) {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { checked, profile } = useSession()
  const home = profile && ROLE_HOME[profile.role]
  // Section links (and the phone Menu) only on the homepage; elsewhere just the logo and auth.
  const sections = !tourist && pathname === "/"
  const current = useCurrentSection(sections)
  const [menuOpen, setMenuOpen] = useState(false)
  const headerRef = useRef(null)
  const taps = useRef(0) // makes each tap a new navigation, so the same link scrolls again

  // The menu closes on Esc and on a tap anywhere outside the header.
  useEffect(() => {
    if (!menuOpen) return undefined
    const onKey = (e) => e.key === "Escape" && setMenuOpen(false)
    const onPointer = (e) => headerRef.current && !headerRef.current.contains(e.target) && setMenuOpen(false)
    document.addEventListener("keydown", onKey)
    document.addEventListener("pointerdown", onPointer)
    return () => {
      document.removeEventListener("keydown", onKey)
      document.removeEventListener("pointerdown", onPointer)
    }
  }, [menuOpen])

  function goTo(id) {
    setMenuOpen(false)
    // To the homepage (if not there), which scrolls to the section (pages/Home.jsx).
    taps.current += 1
    navigate("/", { state: { scrollTo: id, tap: taps.current } })
  }
  async function logOut() {
    await endSession()
    navigate("/login", { replace: true })
  }

  // Hover and keyboard focus: green with a green underline, eased in; the section on
  // screen keeps that look, in bold.
  const sectionLink = (id) =>
    `inline-flex min-h-11 items-center whitespace-nowrap decoration-2 underline-offset-8 transition-colors duration-150 ${focusRing} ${
      current === id
        ? "font-semibold text-sawa-green underline"
        : "text-sawa-text hover:text-sawa-green hover:underline focus-visible:text-sawa-green focus-visible:underline"
    }`

  return (
    <header ref={headerRef} className={`${tourist ? "" : "sticky top-0 z-30"} border-b border-sawa-border bg-sawa-surface`}>
      <div className="mx-auto flex max-w-[1200px] items-center gap-4 px-4 py-1.5 lg:px-8">
        <Link to="/" className={`inline-flex min-h-11 shrink-0 items-center text-base ${focusRing}`}>
          <Brand />
        </Link>

        {sections && (
          <nav aria-label="Sections" className="hidden flex-1 justify-center gap-6 text-sm lg:flex">
            {SECTIONS.map(({ id, label }) => (
              <button key={id} type="button" onClick={() => goTo(id)} className={sectionLink(id)} aria-current={current === id ? "true" : undefined}>
                {label}
              </button>
            ))}
          </nav>
        )}

        <div className={`ml-auto flex shrink-0 items-center gap-4 text-sm ${sections ? "lg:ml-0" : ""}`}>
          {sections && (
            <button
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              aria-expanded={menuOpen}
              aria-controls="site-menu"
              className={`inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap text-sawa-text lg:hidden ${focusRing}`}
            >
              {menuOpen ? <X aria-hidden="true" className="size-5" /> : <Menu aria-hidden="true" className="size-5" />}
              Menu
            </button>
          )}
          {tourist ? (
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-sawa-green">
              <ShieldCheck aria-hidden="true" className="size-4" /> Verified checkout
            </span>
          ) : !checked ? null : profile ? (
            <>
              {home && (
                <>
                  <NavLink to={home.to} end className={navLink}>
                    {home.label}
                  </NavLink>
                  <span aria-hidden="true" className="-mx-2 text-sawa-text-muted">·</span>
                </>
              )}
              <button type="button" onClick={logOut} className={`inline-flex min-h-11 items-center whitespace-nowrap text-sawa-text-muted hover:text-sawa-text ${focusRing}`}>
                Log out
              </button>
            </>
          ) : (
            pathname !== "/login" && (
              <Link to="/login" className={`inline-flex min-h-11 items-center whitespace-nowrap text-sawa-green hover:underline ${focusRing}`}>
                Log in
              </Link>
            )
          )}
        </div>
      </div>


      {sections && menuOpen && (
        <nav id="site-menu" aria-label="Sections" className="border-t border-sawa-border bg-sawa-surface lg:hidden">
          <ul className="mx-auto flex max-w-[1200px] flex-col px-4 py-2">
            {SECTIONS.map(({ id, label }) => (
              <li key={id}>
                <button type="button" onClick={() => goTo(id)} className={`w-full text-left text-[15px] ${sectionLink(id)}`}>
                  {label}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </header>
  )
}

// Sends anyone without a live session for the right role to the login screen. The
// API and Row Level Security enforce access regardless; this only routes people.
function RequireRole({ roles, children }) {
  const { checked, profile } = useSession()
  if (!checked) return null
  if (!profile || !roles.includes(profile.role)) return <Navigate to="/login" replace />
  return children
}

function TouristScreen({ children }) {
  return (
    <>
      <AppHeader tourist />
      {children}
    </>
  )
}

function CoordinatorScreen({ children }) {
  return (
    <RequireRole roles={["coordinator"]}>
      <CoordinatorShell>{children}</CoordinatorShell>
    </RequireRole>
  )
}

function MemberScreen({ children }) {
  return (
    <RequireRole roles={["producer", "driver"]}>
      <AppHeader />
      {children}
    </RequireRole>
  )
}

// HashRouter, not Render's _redirects (CLAUDE.md section 2).
export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<><AppHeader /><Home /></>} />
        <Route path="/pay/:producerId" element={<TouristScreen><PriceCardPage /></TouristScreen>} />
        <Route path="/pay/:producerId/checkout" element={<TouristScreen><CheckoutPage /></TouristScreen>} />
        <Route path="/driver/:code" element={<TouristScreen><DriverPage /></TouristScreen>} />
        <Route path="/stall/:code" element={<TouristScreen><StallPage /></TouristScreen>} />
        <Route path="/demo" element={<><AppHeader /><DemoPage /></>} />
        <Route path="/stand/:code" element={<StandPage />} />
        <Route path="/receipt/:transactionId" element={<TouristScreen><ReceiptPage /></TouristScreen>} />
        <Route path="/login" element={<><AppHeader /><LoginPage /></>} />
        <Route path="/dashboard" element={<MemberScreen><DashboardPage /></MemberScreen>} />
        <Route path="/coordinator" element={<CoordinatorScreen><CoordinatorPage /></CoordinatorScreen>} />
        <Route path="/coordinator/register" element={<CoordinatorScreen><RegisterPage /></CoordinatorScreen>} />
        <Route path="/coordinator/price-cards" element={<CoordinatorScreen><PriceCardsPage /></CoordinatorScreen>} />
        <Route path="/coordinator/accounts" element={<CoordinatorScreen><AccountsPage /></CoordinatorScreen>} />
      </Routes>
    </HashRouter>
  )
}
