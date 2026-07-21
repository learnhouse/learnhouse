import './reference.css'
import { getSpec } from '../../lib/reference/fetch-spec'
import { buildNavIndex } from '../../lib/reference/build-model'
import { TokenProvider } from '../../components/reference/TokenContext'
import ReferenceNav from '../../components/reference/ReferenceNav'

export default async function ReferenceLayout({ children }) {
  const spec = await getSpec()
  const nav = buildNavIndex(spec)

  return (
    <TokenProvider>
      <div className="lh-ref-shell">
        <ReferenceNav nav={nav} />
        <main className="lh-ref-main">{children}</main>
      </div>
    </TokenProvider>
  )
}
