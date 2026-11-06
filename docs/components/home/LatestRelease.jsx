import { getLatestVersions } from '../../lib/releases'
import { HomeHero } from './Home'

// Server component: reads the latest app release (ISR with a bundled
// snapshot fallback, see lib/releases) and renders the home hero with it.
export async function HomeHeroWithRelease() {
  let app = null
  try {
    ;({ app } = await getLatestVersions())
  } catch {
    app = null
  }
  const date = app?.date
    ? new Date(app.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null
  return <HomeHero version={app?.version} date={date} />
}
