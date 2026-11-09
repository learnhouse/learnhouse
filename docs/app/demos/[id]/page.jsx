import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, ArrowRight, ArrowSquareOut, GithubLogo } from '@phosphor-icons/react/dist/ssr'
import { SECTION_ICONS } from '@/components/headless/sections'
import { DEMOS_REPO, demos, getDemo } from '@/lib/demos'
import LiveFrame from '../LiveFrame'
import CtaLink from '@/components/cta/CtaLink'
import { SIGNUP_URL } from '@/lib/cta'
import '../demos.css'
import { clampDescription, socialMetadata } from '../../../lib/seo'

export const dynamicParams = false

export function generateStaticParams() {
  return demos.map((d) => ({ id: d.id }))
}

export async function generateMetadata({ params }) {
  const { id } = await params
  const found = getDemo(id)
  if (!found) return {}
  const { demo } = found
  const title = `${demo.name} demo`
  const description = clampDescription(`${demo.blurb} A LearnHouse Headless demo built on the LearnHouse API.`)
  return {
    title,
    description,
    alternates: { canonical: `https://docs.learnhouse.app/demos/${demo.id}` },
    ...socialMetadata({ title, description, path: `/demos/${demo.id}`, image: `/img/headless/${demo.id}.jpg` }),
  }
}

export default async function DemoPage({ params }) {
  const { id } = await params
  const found = getDemo(id)
  if (!found) notFound()
  const { demo, section, prev, next, liveUrl } = found
  const Icon = SECTION_ICONS[demo.section]

  return (
    <div className="lhdm-page">
      <Link href="/demos" className="lhdm-back">
        <ArrowLeft size={13} weight="bold" /> All demos
      </Link>

      <header className="lhdm-head">
        <div>
          <span className="lhdm-label">
            {Icon && <Icon size={13} weight="bold" />} {section?.title}
          </span>
          <h1 className="lhdm-title">{demo.name}</h1>
          <p className="lhdm-lede">{demo.blurb}</p>
          <div className="lhdm-features">
            {demo.features.map((f) => (
              <span key={f}>{f}</span>
            ))}
          </div>
        </div>
        <div className="lhdm-actions">
          <CtaLink href={SIGNUP_URL} placement="demo_header" term={demo.id} target="_blank" rel="noopener" className="lhdm-btn lhdm-btn-primary">
            Build this on your academy
          </CtaLink>
          {liveUrl && (
            <a href={liveUrl} target="_blank" rel="noopener noreferrer" className="lhdm-btn">
              Open full screen <ArrowSquareOut size={13} weight="bold" />
            </a>
          )}
          <a href={DEMOS_REPO} target="_blank" rel="noopener noreferrer" className="lhdm-btn">
            <GithubLogo size={14} weight="fill" /> Source
          </a>
        </div>
      </header>

      {liveUrl ? (
        <LiveFrame src={liveUrl} poster={`/img/headless/${demo.id}.jpg`} title={demo.name} />
      ) : (
        <div className="lhdm-frame">
          <div className="lhdm-frame-bar">
            <i />
            <i />
            <i />
            <span>Screenshot</span>
          </div>
          <img className="lhdm-shot" src={`/img/headless/${demo.id}.jpg`} alt={`${demo.name} demo`} />
        </div>
      )}

      <section className="lhdm-grid">
        <div className="lhdm-card">
          <span className="lhdm-label">How it works</span>
          <p>
            A Next.js app that reads courses, chapters and lessons from the LearnHouse API on its own server, so no
            token reaches the browser. It uses {demo.features.join(', ')}.
          </p>
          <Link href="/developers" className="lhdm-link">
            Build on LearnHouse <ArrowRight size={12} weight="bold" />
          </Link>
        </div>
        <div className="lhdm-card">
          <span className="lhdm-label">Your own academy</span>
          <p>
            Everything this demo shows comes from a LearnHouse academy. Create yours for free, add a course, then point
            the demo at it with your organization&apos;s slug.
          </p>
          <CtaLink href={SIGNUP_URL} placement="demo_card" term={demo.id} target="_blank" rel="noopener" className="lhdm-link">
            Start free on LearnHouse Cloud <ArrowRight size={12} weight="bold" />
          </CtaLink>
        </div>
        <div className="lhdm-card">
          <span className="lhdm-label">Start from it</span>
          <pre>{`git clone ${DEMOS_REPO}\ncd headless-examples && bun install\nbun dev --port 3100   # then open /${demo.id}`}</pre>
        </div>
      </section>

      <nav className="lhdm-pager" aria-label="More demos">
        <Link href={`/demos/${prev.id}`} className="lhdm-pager-link">
          <span className="lhdm-label">Previous</span>
          {prev.name}
        </Link>
        <Link href={`/demos/${next.id}`} className="lhdm-pager-link lhdm-pager-next">
          <span className="lhdm-label">Next</span>
          {next.name}
        </Link>
      </nav>
    </div>
  )
}
