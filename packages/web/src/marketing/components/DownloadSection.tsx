import { motion } from 'motion/react'
import { Apple, ArrowRight } from 'lucide-react'
import { useLatestRelease } from '../hooks/useLatestRelease'

export default function DownloadSection() {
  const { release } = useLatestRelease()
  const dmgUrl = release?.dmgUrl ?? '#download'
  return (
    <section className="mk-download" id="download">
      <div className="mk-download__glow" aria-hidden />
      <div className="mk-container">
        <motion.div
          className="mk-download__content"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.5 }}
        >
          <h2 className="mk-download__title">Ready to code smarter?</h2>
          <p className="mk-download__subtitle">
            Download Codr for Mac and start shipping faster today.
          </p>
          <div className="mk-download__actions">
            <motion.a
              href={dmgUrl}
              className="mk-btn mk-btn--primary mk-btn--lg"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.97 }}
            >
              <Apple size={22} />
              Download for Mac
              {release && <span className="mk-btn__version">v{release.version}</span>}
            </motion.a>
            <motion.a
              href="/app"
              className="mk-btn mk-btn--ghost"
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
            >
              Or use in browser
              <ArrowRight size={16} />
            </motion.a>
          </div>
        </motion.div>
      </div>
    </section>
  )
}
