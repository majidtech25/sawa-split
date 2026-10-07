import { useEffect, useState } from "react"
import { HashRouter, Link, Navigate, NavLink, Route, Routes, useNavigate } from "react-router-dom"
import Home from "./pages/Home"
import LoginPage from "./pages/LoginPage"
import { CheckoutPage, PriceCardPage } from "./pages/PayPage"
import DashboardPage from "./pages/DashboardPage"
import ReceiptPage from "./pages/ReceiptPage"
import CoordinatorPage from "./pages/CoordinatorPage"
import PriceCardsPage from "./pages/PriceCardsPage"
import RegisterPage from "./pages/RegisterPage"
import { currentProfile, endSession, supabase } from "./lib/supabase"

const focusRing =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sawa-green"

function AppHeader({ wide = false, nav = null, signedIn = false }) {
  const navigate = useNavigate()
  async function logOut() {
    await endSession()
    navigate("/login", { replace: true })
  }
  return (
    <header className="border-b border-sawa-border bg-sawa-surface">
      <div className={`mx-auto flex items-center justify-between gap-4 px-4 py-3 ${wide ? "max-w-[420px] md:max-w-6xl md:px-8" : "max-w-[420px]"}`}>
        <Link to="/" className={`text-base font-bold tracking-tight ${focusRing}`}>
          Sawa <span className="text-sawa-green">Split</span>
        </Link>
        <div className="flex items-center gap-4 text-sm">
          {nav}
          {signedIn && (
            <button type="button" onClick={logOut} className={`text-sawa-text-muted hover:text-sawa-text ${focusRing}`}>
              Log out
            </button>
          )}
        </div>
      </div>
    </header>
  )
}

function CoordinatorNav() {
  const link = ({ isActive }) => `${focusRing} ${isActive ? "font-semibold text-sawa-text" : "text-sawa-green hover:underline"}`
  return (
    <nav aria-label="Coordinator" className="flex flex-wrap gap-x-4 gap-y-1">
      <NavLink to="/coordinator" end className={link}>
        Reconciliation
      </NavLink>
      <NavLink to="/coordinator/register" className={link}>
        Register
      </NavLink>
      <NavLink to="/coordinator/price-cards" className={link}>
        Price cards
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
      <AppHeader wide signedIn nav={<CoordinatorNav />} />
      {children}
    </RequireRole>
  )
}

function MemberScreen({ children }) {
  return (
    <RequireRole roles={["producer", "driver"]}>
      <AppHeader signedIn />
      {children}
    </RequireRole>
  )
}

// HashRouter, not Render's _redirects (CLAUDE.md section 2).
export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/pay/:producerId" element={<TouristScreen><PriceCardPage /></TouristScreen>} />
        <Route path="/pay/:producerId/checkout" element={<TouristScreen><CheckoutPage /></TouristScreen>} />
        <Route path="/receipt/:transactionId" element={<TouristScreen><ReceiptPage /></TouristScreen>} />
        <Route path="/login" element={<TouristScreen><LoginPage /></TouristScreen>} />
        <Route path="/dashboard" element={<MemberScreen><DashboardPage /></MemberScreen>} />
        <Route path="/coordinator" element={<CoordinatorScreen><CoordinatorPage /></CoordinatorScreen>} />
        <Route path="/coordinator/register" element={<CoordinatorScreen><RegisterPage /></CoordinatorScreen>} />
        <Route path="/coordinator/price-cards" element={<CoordinatorScreen><PriceCardsPage /></CoordinatorScreen>} />
      </Routes>
    </HashRouter>
  )
}
