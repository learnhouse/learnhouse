import './reference.css'
import { getSpec } from '../../lib/reference/fetch-spec'
import { buildNavIndex } from '../../lib/reference/build-model'
import { GUIDES } from '../../lib/reference/config'
import { TokenProvider } from '../../components/reference/TokenContext'
import ReferenceNav from '../../components/reference/ReferenceNav'

export default async function ReferenceLayout({ children }) {
  const spec = await getSpec()
  const nav = buildNavIndex(spec)
  const guides = GUIDES.map(({ slug, title }) => ({ slug, title }))

  return (
    <TokenProvider>
      <div className="lhr">
        <ReferenceNav nav={nav} guides={guides} />
        <main className="lhr-main" id="lhr-main">
          {children}
        </main>
      </div>
    </TokenProvider>
  )
}
