import { motion } from 'motion/react'
import { Apple, ArrowRight } from 'lucide-react'
import AppMockup from './AppMockup'
import { useLatestRelease } from '../hooks/useLatestRelease'

export default function HeroSection() {
  const { release } = useLatestRelease()
  const dmgUrl = release?.dmgUrl ?? '#download'
  return (
    <section className="mk-hero">
      {/* Ambient floating orbs */}
      <div className="mk-hero__orbs" aria-hidden>
        <motion.div
          className="mk-hero__orb mk-hero__orb--1"
          initial={{ y: 0, opacity: 0.3 }}
          animate={{ y: [0, -20, 0], opacity: [0.3, 0.5, 0.3] }}
          transition={{ duration: 7, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="mk-hero__orb mk-hero__orb--2"
          initial={{ y: 0, opacity: 0.2 }}
          animate={{ y: [0, 15, 0], opacity: [0.2, 0.4, 0.2] }}
          transition={{ duration: 9, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="mk-hero__orb mk-hero__orb--3"
          initial={{ y: 0, x: 0 }}
          animate={{ y: [0, -12, 0], x: [0, 8, 0] }}
          transition={{ duration: 11, repeat: Infinity, ease: 'easeInOut' }}
        />
      </div>

      <div className="mk-container">
        <motion.p
          className="mk-hero__badge"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          Now available for macOS
        </motion.p>

        <motion.h1
          className="mk-hero__title"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.1 }}
        >
          Cursor level UI,{' '}
          <span className="mk-hero__title-accent">for Claude Code.</span>
        </motion.h1>

        <motion.p
          className="mk-hero__subtitle"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.25 }}
        >
          An intelligent coding agent that lives on your machine. Edit files,
          run commands, and ship features — all from a single conversation.
        </motion.p>

        <motion.div
          className="mk-hero__actions"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.4 }}
        >
          <motion.a
            href={dmgUrl}
            className="mk-btn mk-btn--primary"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.97 }}
          >
            <Apple size={20} />
            Download for Apple Silicon
            {release && <span className="mk-btn__version">v{release.version}</span>}
          </motion.a>
          <motion.a
            href="/app"
            className="mk-btn mk-btn--secondary"
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
          >
            Web App
            <ArrowRight size={16} />
          </motion.a>
        </motion.div>


        {/* Hero image placeholder — replace src with real screenshot */}
        <motion.div
          className="mk-hero__image-wrapper"
          initial={{ opacity: 0, y: 50 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', damping: 20, stiffness: 80, delay: 0.55 }}
        >
          <div className="mk-hero__image-glow" />
          <AppMockup />
        </motion.div>
      </div>
    </section>
  )
}
