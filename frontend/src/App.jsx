import { useEffect, useState } from "react"
import { HashRouter, Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom"
import Home from "./pages/Home"
import LoginPage from "./pages/LoginPage"
import { CheckoutPage, PriceCardPage } from "./pages/PayPage"
import DriverPage from "./pages/DriverPage"
import DashboardPage from "./pages/DashboardPage"
import ReceiptPage from "./pages/ReceiptPage"
import AccountsPage from "./pages/AccountsPage"
import CoordinatorPage from "./pages/CoordinatorPage"
import PriceCardsPage from "./pages/PriceCardsPage"
import RegisterPage from "./pages/RegisterPage"
import { currentProfile, endSession, supabase } from "./lib/supabase"

const focusRing =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sawa-green"

const HEADER_WIDTHS = {
  card: "max-w-[420px] px-4",
  wide: "max-w-[420px] px-4 md:max-w-6xl md:px-8",
  page: "max-w-6xl px-6", // the homepage's own full-width layout
}

const ROLE_HOME = {
  coordinator: { to: "/coordinator", label: "Reconciliation" },
  producer: { to: "/dashboard", label: "Dashboard" },
  driver: { to: "/dashboard", label: "Dashboard" },
}

const navLink = ({ isActive }) =>
  `whitespace-nowrap ${focusRing} ${isActive ? "font-semibold text-sawa-text" : "text-sawa-green hover:underline"}`

// Signed in: the role's home link (or the coordinator's nav) and "Log out". Signed
// out: "Log in". There's no sign-up link: accounts are created by a coordinator.
function AppHeader({ width = "card", nav = null }) {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const profile = currentProfile()
  const home = profile && ROLE_HOME[profile.role]
  async function logOut() {
    await endSession()
    navigate("/login", { replace: true })
  }
  return (
    <header className="border-b border-sawa-border bg-sawa-surface">
      {/* On phones a nav drops to its own row so the brand and "Log out" never wrap. */}
      <div className={`mx-auto flex flex-wrap items-center gap-x-4 gap-y-2 py-3 ${HEADER_WIDTHS[width]}`}>
        <Link to="/" className={`whitespace-nowrap text-base font-bold tracking-tight ${focusRing}`}>
          Sawa <span className="text-sawa-green">Split</span>
        </Link>
        {nav && <div className="order-last w-full text-sm md:order-none md:ml-auto md:w-auto">{nav}</div>}
        <div className={`ml-auto flex items-center gap-4 text-sm ${nav ? "md:ml-0" : ""}`}>
          {home && !nav && (
            <NavLink to={home.to} end className={navLink}>
              {home.label}
            </NavLink>
          )}
          {profile ? (
            <button type="button" onClick={logOut} className={`whitespace-nowrap text-sawa-text-muted hover:text-sawa-text ${focusRing}`}>
              Log out
            </button>
          ) : (
            pathname !== "/login" && (
              <Link to="/login" className={`whitespace-nowrap text-sawa-green hover:underline ${focusRing}`}>
                Log in
              </Link>
            )
          )}
        </div>
      </div>
    </header>
  )
}

function CoordinatorNav() {
  return (
    <nav aria-label="Coordinator" className="flex flex-wrap gap-x-4 gap-y-1">
      <NavLink to="/coordinator" end className={navLink}>
        Reconciliation
      </NavLink>
      <NavLink to="/coordinator/register" className={navLink}>
        Register
      </NavLink>
      <NavLink to="/coordinator/price-cards" className={navLink}>
        Price cards
      </NavLink>
      <NavLink to="/coordinator/accounts" className={navLink}>
        Accounts
      </NavLink>
    </nav>
  )
}

// Sends anyone without a live session for the right role to the login screen. The
// API and Row Level Security enforce access regardless; this only routes people.
function RequireRole({ roles, children }) {
  const profile = currentProfile()
  const [state, setState] = useState("checking")
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setState(data.session ? "ok" : "none"))
  }, [])
  if (!profile || !roles.includes(profile.role)) return <Navigate to="/login" replace />
  if (state === "none") return <Navigate to="/login" replace />
  if (state === "checking") return null
  return children
}

function TouristScreen({ children }) {
  return (
    <>
      <AppHeader />
      {children}
    </>
  )
}

function CoordinatorScreen({ children }) {
  return (
    <RequireRole roles={["coordinator"]}>
      <AppHeader width="wide" nav={<CoordinatorNav />} />
      {children}
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
        <Route path="/" element={<><AppHeader width="page" /><Home /></>} />
        <Route path="/pay/:producerId" element={<TouristScreen><PriceCardPage /></TouristScreen>} />
        <Route path="/pay/:producerId/checkout" element={<TouristScreen><CheckoutPage /></TouristScreen>} />
        <Route path="/driver/:code" element={<TouristScreen><DriverPage /></TouristScreen>} />
        <Route path="/receipt/:transactionId" element={<TouristScreen><ReceiptPage /></TouristScreen>} />
        <Route path="/login" element={<TouristScreen><LoginPage /></TouristScreen>} />
        <Route path="/dashboard" element={<MemberScreen><DashboardPage /></MemberScreen>} />
        <Route path="/coordinator" element={<CoordinatorScreen><CoordinatorPage /></CoordinatorScreen>} />
        <Route path="/coordinator/register" element={<CoordinatorScreen><RegisterPage /></CoordinatorScreen>} />
        <Route path="/coordinator/price-cards" element={<CoordinatorScreen><PriceCardsPage /></CoordinatorScreen>} />
        <Route path="/coordinator/accounts" element={<CoordinatorScreen><AccountsPage /></CoordinatorScreen>} />
      </Routes>
    </HashRouter>
  )
}
