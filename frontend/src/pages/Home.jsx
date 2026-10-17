import Hero from "../sections/Hero"
import Problem from "../sections/Problem"
import Solution from "../sections/Solution"
import WhoItsFor from "../sections/WhoItsFor"
import Trust from "../sections/Trust"
import Roadmap from "../sections/Roadmap"
import SiteFooter from "../sections/SiteFooter"

export default function Home() {
  return (
    <div className="min-h-screen bg-sawa-bg text-sawa-text">
      <Hero />
      <Problem />
      <Solution />
      <WhoItsFor />
      <Trust />
      <Roadmap />
      <SiteFooter />
    </div>
  )
}
