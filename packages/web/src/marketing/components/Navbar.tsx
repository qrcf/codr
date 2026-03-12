import { useState, useEffect } from 'react'
import { motion } from 'motion/react'
import { Download } from 'lucide-react'
import { useLatestRelease } from '../hooks/useLatestRelease'

export default function Navbar() {
  const { release } = useLatestRelease()
  const dmgUrl = release?.dmgUrl ?? '#download'
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <motion.nav
      className={`mk-navbar ${scrolled ? 'mk-navbar--scrolled' : ''}`}
      initial={{ y: -20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.5 }}
    >
      <div className="mk-navbar__inner">
        <a href="/" className="mk-navbar__logo">
          <img src="/codr-logo-transparent.png" alt="Codr" className="mk-navbar__logo-img" />
          Codr
        </a>

        <div className="mk-navbar__links">
          <a href="#features" className="mk-navbar__link">Features</a>
          <a href="#demo" className="mk-navbar__link">Demo</a>
          <a href="/app" className="mk-navbar__link">Sign In</a>
          <motion.a
            href={dmgUrl}
            className="mk-navbar__download"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.97 }}
          >
            <Download size={16} />
            Download
            {release && <span className="mk-btn__version">v{release.version}</span>}
          </motion.a>
        </div>
      </div>
    </motion.nav>
  )
}
