import { useEffect } from "react"
import { useLocation } from "react-router-dom"
import Hero from "../sections/Hero"
import Problem from "../sections/Problem"
import Solution from "../sections/Solution"
import WhoItsFor from "../sections/WhoItsFor"
import Trust from "../sections/Trust"
import BeforeAfter from "../sections/BeforeAfter"
import Roadmap from "../sections/Roadmap"
import Contact from "../sections/Contact"
import SiteFooter from "../sections/SiteFooter"

export default function Home() {
  // The demo's "contact us" lands here and scrolls to the section (HashRouter: no #anchors).
  const { state } = useLocation()
  useEffect(() => {
    if (state?.scrollTo) document.getElementById(state.scrollTo)?.scrollIntoView({ block: "start" })
  }, [state])
  return (
    <div className="min-h-screen bg-sawa-bg text-sawa-text">
      <Hero />
      <Problem />
      <Solution />
      <WhoItsFor />
      <Trust />
      <BeforeAfter />
      <Roadmap />
      <Contact />
      <SiteFooter />
    </div>
  )
}
