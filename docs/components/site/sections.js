// The docs are split into tabs. The navbar shows them, and the sidebar only
// lists the content folders of the active one.
import { RocketLaunch, AppWindow, HardDrives, Code, SquaresFour, BracketsCurly, Tag } from '@phosphor-icons/react/dist/ssr'
import { TAB_DATA } from './tabs.mjs'

const ICONS = { start: RocketLaunch, platform: AppWindow, 'self-hosting': HardDrives, developers: Code, demos: SquaresFour, reference: BracketsCurly, releases: Tag }

export const TABS = TAB_DATA.map((tab) => ({ ...tab, icon: ICONS[tab.key] }))

const under = (pathname, route) => pathname === route || pathname.startsWith(route + '/')

export function activeTab(pathname = '/') {
  if (pathname === '/') return TABS[0]
  return (
    TABS.find((tab) => under(pathname, tab.href) || tab.folders.some((folder) => under(pathname, folder))) ?? TABS[0]
  )
}
