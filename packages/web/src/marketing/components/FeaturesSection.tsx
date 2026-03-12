import { motion } from 'motion/react'
import {
  ClipboardList,
  BookOpen,
  AtSign,
  Smartphone,
  Bot,
  FileEdit,
} from 'lucide-react'

const features = [
  {
    icon: ClipboardList,
    title: 'Plan, Review, Execute',
    description:
      'Break complex tasks into structured plans. Review each step, approve or request changes, then watch Codr execute — with full visibility at every stage.',
  },
  {
    icon: BookOpen,
    title: 'Indexed Documentation',
    description:
      'Add any docs URL and Codr crawls and indexes it for you. Reference your custom docs inline with @ — framework guides, internal wikis, API references, all searchable.',
  },
  {
    icon: AtSign,
    title: 'File & Doc Tagging',
    description:
      'Tag files and docs directly in your prompt with @. Codr pulls in the right context automatically — no copy-pasting, no switching tabs.',
  },
  {
    icon: Smartphone,
    title: 'Desktop to Mobile, Live',
    description:
      'Start a session on your desktop and pick it up on your phone. Every message streams in real time to the web client — review code, approve plans, anywhere.',
  },
  {
    icon: Bot,
    title: 'Agent-Powered',
    description:
      'Claude works as your coding partner — understanding context, writing code, and iterating with you in real time.',
  },
  {
    icon: FileEdit,
    title: 'Multi-File Editing',
    description:
      'Read, write, and refactor across your entire codebase. See diffs before they\'re applied.',
  },
]

export default function FeaturesSection() {
  return (
    <section className="mk-features" id="features">
      <div className="mk-container">
        <motion.div
          className="mk-features__header"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.5 }}
        >
          <h2 className="mk-features__title">More than autocomplete</h2>
          <p className="mk-features__subtitle">
            Plan complex tasks, index your docs, tag context inline, and sync across devices.
          </p>
        </motion.div>

        <div className="mk-features__grid">
          {features.map((feature, i) => (
            <motion.div
              key={feature.title}
              className="mk-feature-card"
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-60px' }}
              transition={{ duration: 0.5, delay: i * 0.08 }}
            >
              <div className="mk-feature-card__icon">
                <feature.icon size={24} />
              </div>
              <h3 className="mk-feature-card__title">{feature.title}</h3>
              <p className="mk-feature-card__desc">{feature.description}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}
