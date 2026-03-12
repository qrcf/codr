import Navbar from './components/Navbar'
import HeroSection from './components/HeroSection'
import FeaturesSection from './components/FeaturesSection'
import TerminalDemo from './components/TerminalDemo'
import DownloadSection from './components/DownloadSection'
import Footer from './components/Footer'
import './MarketingPage.css'

export default function MarketingPage() {
  return (
    <div className="mk">
      <Navbar />
      <main>
        <HeroSection />
        <FeaturesSection />
        <TerminalDemo />
        <DownloadSection />
      </main>
      <Footer />
    </div>
  )
}
