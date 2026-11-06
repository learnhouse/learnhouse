import Link from 'next/link'
import { ArrowRight } from '@phosphor-icons/react/dist/ssr'
import catalog from '../headless/demos.json'
import { SECTION_ICONS } from '../headless/sections'
import './home.css'

const sectionTitle = Object.fromEntries(catalog.sections.map((s) => [s.id, s.title]))

function Row({ demos, reverse }) {
  // The list is rendered twice so the loop is seamless; the copy is hidden from assistive tech.
  return (
    <div className={`lhh-marquee ${reverse ? 'lhh-marquee-reverse' : ''}`}>
      <div className="lhh-marquee-track">
        {[0, 1].map((copy) => (
          <div key={copy} className="lhh-marquee-set" aria-hidden={copy === 1 || undefined}>
            {demos.map((demo) => {
              const Icon = SECTION_ICONS[demo.section]
              return (
                <Link key={`${copy}-${demo.id}`} href={`/demos/${demo.id}`} className="lhh-demo" tabIndex={copy === 1 ? -1 : undefined}>
                  <span className="lhh-demo-shot">
                    <img src={`/img/headless/${demo.id}.jpg`} alt={copy === 1 ? '' : `${demo.name} demo`} loading="lazy" decoding="async" width="960" height="600" />
                  </span>
                  <span className="lhh-demo-meta">
                    <span className="lhh-demo-name">{demo.name}</span>
                    <span className="lhh-demo-section">
                      {Icon && <Icon size={11} weight="bold" />}
                      {sectionTitle[demo.section]}
                    </span>
                  </span>
                </Link>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

/** LearnHouse Headless on the docs home: the pitch, and the demos rolling by. */
export function HeadlessShowcase() {
  const half = Math.ceil(catalog.demos.length / 2)
  // Interleave sections so each row mixes products, themes, embeds…
  const mixed = [...catalog.demos].sort((a, b) => catalog.demos.indexOf(a) % 10 - catalog.demos.indexOf(b) % 10)
  return (
    <section className="lhh-showcase">
      <div className="lhh-showcase-head">
        <span className="lhh-label">LearnHouse Headless</span>
        <h2 className="lhh-showcase-title">Build your own learning platform</h2>
        <p className="lhh-showcase-text">
          LearnHouse keeps your courses, learners and progress. You decide where learning happens: your site, your app,
          a widget, a chatbot. {catalog.demos.length} open-source demos show how far it goes.
        </p>
        <div className="lhh-showcase-actions">
          <Link href="/demos" className="lhh-btn lhh-btn-primary">
            Explore the demos <ArrowRight size={13} weight="bold" />
          </Link>
          <Link href="/developers" className="lhh-btn">
            Developer docs
          </Link>
        </div>
      </div>
      <Row demos={mixed.slice(0, half)} />
      <Row demos={mixed.slice(half)} reverse />
    </section>
  )
}
