import Link from 'next/link'
import { ArrowRight } from '@phosphor-icons/react/dist/ssr'
import { DemoGallery } from '@/components/headless/Headless'
import { demos } from '@/lib/demos'
import './demos.css'

export const metadata = {
  title: 'Demos',
  description: `${demos.length} apps built on the LearnHouse API: products, themes, embeds, AI experiments and industry portals. Try them live and start from their open-source code.`,
  alternates: { canonical: 'https://docs.learnhouse.app/demos' },
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
