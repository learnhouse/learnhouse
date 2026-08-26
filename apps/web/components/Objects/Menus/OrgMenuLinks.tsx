import { useOrg } from '@components/Contexts/OrgContext'
import { getUriWithOrg } from '@services/config/config'
import { Books, ChatsCircle, Briefcase } from '@phosphor-icons/react'
import { menuIcon } from '@components/Objects/Menus/menuIcons'
import Link from 'next/link'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { getMenuColorClasses } from '@services/utils/ts/colorUtils'

type Builtin = { feature?: string; link: string; labelKey?: string; label?: string; Icon: any }

const BUILTIN: Record<string, Builtin> = {
  courses: { feature: 'courses', link: '/courses', labelKey: 'courses.courses', Icon: Books },
  portfolio: { link: '/portfolio', label: 'My Portfolio', Icon: Briefcase },
  communities: { feature: 'communities', link: '/communities', labelKey: 'communities.title', Icon: ChatsCircle },
}

// Acyberschool learner navigation is intentionally small. Trainers keep the
// richer creation/admin tools inside Dashboard rather than exposing them as a
// learner navigation maze.
const DEFAULT_ORDER = ['courses', 'portfolio', 'communities']

function MenuLinks(props: { orgslug: string; primaryColor?: string }) {
  const { t } = useTranslation()
  const org = useOrg() as any
  const colors = getMenuColorClasses(props.primaryColor || '')

  const rf = org?.config?.config?.resolved_features
  const isEnabled = (feature?: string) => !feature || rf?.[feature]?.enabled === true

  const configItems: any[] | undefined =
    org?.config?.config?.customization?.menu?.items ?? org?.config?.config?.general?.menu?.items

  // Preserve explicit trainer-configured custom links, but use the focused
  // Acyberschool navigation when no custom menu is configured.
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
      if (!isEnabled(meta.feature)) return null
      return {
        key: item.type,
        label: item.label || meta.label || (meta.labelKey ? t(meta.labelKey) : item.type),
        Icon: meta.Icon,
        href: getUriWithOrg(props.orgslug, meta.link),
        external: false,
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
          return it.external ? (
            <a key={it.key} href={it.href} target="_blank" rel="noopener noreferrer">{content}</a>
          ) : (
            <Link key={it.key} href={it.href}>{content}</Link>
          )
        })}
      </ul>
    </div>
  )
}

export default MenuLinks
