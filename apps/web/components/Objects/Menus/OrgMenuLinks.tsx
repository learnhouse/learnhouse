import { useOrg } from '@components/Contexts/OrgContext'
import { getUriWithOrg } from '@services/config/config'
import { Books, FolderSimple, ChatsCircle, Headphones, Cube, ShoppingBag } from '@phosphor-icons/react'
import { menuIcon } from '@components/Objects/Menus/menuIcons'
import Link from 'next/link'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { getMenuColorClasses } from '@services/utils/ts/colorUtils'
import { ShortcutHint } from '@components/Objects/Shortcuts/ShortcutHint'
import { sitePages } from '@/lib/site-search/registry'

// Chord per builtin menu entry, read from the same registry the palette uses.
const CHORD_BY_TYPE: Record<string, string | undefined> = Object.fromEntries(
  sitePages.filter((p) => p.menuType && p.shortcut).map((p) => [p.menuType as string, p.shortcut]),
)

type Builtin = { feature: string; link: string; labelKey: string; Icon: any }

const BUILTIN: Record<string, Builtin> = {
  courses: { feature: 'courses', link: '/courses', labelKey: 'courses.courses', Icon: Books },
  library: { feature: 'folders', link: '/library', labelKey: 'library.library', Icon: FolderSimple },
  podcasts: { feature: 'podcasts', link: '/podcasts', labelKey: 'podcasts.podcasts', Icon: Headphones },
  communities: { feature: 'communities', link: '/communities', labelKey: 'communities.title', Icon: ChatsCircle },
  playgrounds: { feature: 'playgrounds', link: '/playgrounds', labelKey: 'common.playgrounds', Icon: Cube },
  store: { feature: 'payments', link: '/store', labelKey: 'common.store', Icon: ShoppingBag },
}

// Default order when an org has no custom menu config.
const DEFAULT_ORDER = ['courses', 'library', 'podcasts', 'communities', 'playgrounds', 'store']

function MenuLinks(props: { orgslug: string; primaryColor?: string }) {
  const { t } = useTranslation()
  const org = useOrg() as any
  const colors = getMenuColorClasses(props.primaryColor || '')

  const rf = org?.config?.config?.resolved_features
  const isEnabled = (feature: string) => rf?.[feature]?.enabled === true

  const configItems: any[] | undefined =
    org?.config?.config?.customization?.menu?.items ?? org?.config?.config?.general?.menu?.items

  // Build the items to render (config-driven, else feature-driven defaults)
  const source =
    configItems && configItems.length
      ? [...configItems].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      : DEFAULT_ORDER.map((type, i) => ({ type, enabled: true, order: i, label: '', url: '' }))

  const rendered = source
    .map((item: any) => {
      if (item.type === 'custom') {
        if (!item.enabled || !item.url) return null
        const external = /^https?:\/\//i.test(item.url)
        return {
          key: `custom-${item.url}`,
          label: item.label || item.url,
          Icon: menuIcon(item.icon),
          href: external ? item.url : getUriWithOrg(props.orgslug, item.url),
          external,
        }
      }
      const meta = BUILTIN[item.type]
      if (!meta) return null
      if (!item.enabled) return null
      if (!isEnabled(meta.feature)) return null // plan/feature gating
      return {
        key: item.type,
        label: item.label || t(meta.labelKey),
        Icon: meta.Icon,
        href: getUriWithOrg(props.orgslug, meta.link),
        external: false,
        shortcut: CHORD_BY_TYPE[item.type],
      }
    })
    .filter(Boolean) as any[]

  return (
    <div className="ps-1">
      <ul className="flex space-x-5">
        {rendered.map((it) => {
          const content = (
            <li className={`flex space-x-2 items-center ${colors.text} font-semibold`}>
              <it.Icon size={20} weight="fill" /> <span>{it.label}</span>
            </li>
          )
          if (it.external) {
            return (
              <a key={it.key} href={it.href} target="_blank" rel="noopener noreferrer">{content}</a>
            )
          }
          const link = <Link href={it.href}>{content}</Link>
          return it.shortcut ? (
            <ShortcutHint key={it.key} label={t('shortcuts.go_to', { page: it.label })} keys={it.shortcut}>
              {link}
            </ShortcutHint>
          ) : (
            <React.Fragment key={it.key}>{link}</React.Fragment>
          )
        })}
      </ul>
    </div>
  )
}

export default MenuLinks
