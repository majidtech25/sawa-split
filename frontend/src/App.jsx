import { HashRouter, Link, Route, Routes } from "react-router-dom"
import Home from "./pages/Home"
import { CheckoutPage, PriceCardPage } from "./pages/PayPage"
import ReceiptPage from "./pages/ReceiptPage"

function AppHeader() {
  return (
    <header className="border-b border-sawa-border bg-sawa-surface">
      <div className="mx-auto flex max-w-[420px] items-center justify-between px-4 py-3">
        <Link to="/" className="text-base font-bold tracking-tight">
          Sawa <span className="text-sawa-green">Split</span>
        </Link>
      </div>
    </header>
  )
}

function AppScreen({ children }) {
  return (
    <>
      <AppHeader />
      {children}
    </>
  )
}

// HashRouter, not Render's _redirects (CLAUDE.md section 2).
export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/pay/:producerId" element={<AppScreen><PriceCardPage /></AppScreen>} />
        <Route path="/pay/:producerId/checkout" element={<AppScreen><CheckoutPage /></AppScreen>} />
        <Route path="/receipt/:transactionId" element={<AppScreen><ReceiptPage /></AppScreen>} />
      </Routes>
    </HashRouter>
  )
}
