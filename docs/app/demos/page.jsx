import Link from 'next/link'
import { ArrowRight } from '@phosphor-icons/react/dist/ssr'
import { DemoGallery } from '@/components/headless/Headless'
import { demos } from '@/lib/demos'
import './demos.css'
import { socialMetadata } from '../../lib/seo'

const DESCRIPTION = `${demos.length} open-source apps built on the LearnHouse API: course sites, themes, embeds, AI tools and industry portals. Try them and start from their code.`

export const metadata = {
  title: 'Demos',
  description: DESCRIPTION,
  alternates: { canonical: 'https://docs.learnhouse.app/demos' },
  ...socialMetadata({ title: 'LearnHouse Headless demos', description: DESCRIPTION, path: '/demos', image: '/og/demos' }),
}

export default function DemosPage() {
  return (
    <div className="lhdm-page lhdm-index">
      <header className="lhdm-index-head">
        <span className="lhdm-label">LearnHouse Headless</span>
        <h1 className="lhdm-title">{demos.length} things you can build on LearnHouse</h1>
        <p className="lhdm-lede">
          Every demo reads the same courses through the LearnHouse API, from full products to a single widget. Open one to
          try it live, then start from its code.
        </p>
        <div className="lhdm-actions">
          <Link href="/developers" className="lhdm-btn lhdm-btn-primary">
            Build your own <ArrowRight size={13} weight="bold" />
          </Link>
          <Link href="/developers/sdk" className="lhdm-btn">
            JavaScript SDK
          </Link>
        </div>
      </header>
      <DemoGallery />
    </div>
  )
}
