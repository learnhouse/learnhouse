'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { BookOpen, BriefcaseBusiness, Home, MessageCircle, UserRound } from 'lucide-react'

import { getUriWithOrg } from '@services/config/config'

const NAVY = '#0B263D'
const RED = '#C51635'

type Item = {
  label: string
  href: string
  icon: any
  active: (pathname: string) => boolean
}

export default function AcyberMobileDock({ orgslug }: { orgslug: string }) {
  const pathname = usePathname() || ''
  const root = getUriWithOrg(orgslug, '/')

  const items: Item[] = [
    {
      label: 'Home',
      href: root,
      icon: Home,
      active: (path) => path === root || path === `${root}/`,
    },
    {
      label: 'Learn',
      href: getUriWithOrg(orgslug, '/courses'),
      icon: BookOpen,
      active: (path) => path.includes('/course') || path.includes('/courses'),
    },
    {
      label: 'Community',
      href: getUriWithOrg(orgslug, '/communities'),
      icon: MessageCircle,
      active: (path) => path.includes('/communit'),
    },
    {
      label: 'Portfolio',
      href: getUriWithOrg(orgslug, '/portfolio'),
      icon: BriefcaseBusiness,
      active: (path) => path.includes('/portfolio'),
    },
    {
      label: 'Me',
      href: getUriWithOrg(orgslug, '/trail'),
      icon: UserRound,
      active: (path) => path.includes('/trail'),
    },
  ]

  return (
    <nav
      aria-label="Acyberschool mobile navigation"
      className="fixed inset-x-0 bottom-0 z-[80] border-t border-black/10 bg-white/95 px-2 pb-[max(0.45rem,env(safe-area-inset-bottom))] pt-2 shadow-[0_-12px_35px_rgba(11,38,61,0.08)] backdrop-blur-xl md:hidden"
    >
      <div className="mx-auto grid max-w-lg grid-cols-5 gap-1">
        {items.map((item) => {
          const Icon = item.icon
          const selected = item.active(pathname)
          return (
            <Link
              key={item.label}
              href={item.href}
              className="flex min-h-[50px] flex-col items-center justify-center gap-1 rounded-xl px-1 text-[10px] font-extrabold transition-colors"
              style={{ color: selected ? RED : `${NAVY}99`, backgroundColor: selected ? '#FFF1F3' : 'transparent' }}
            >
              <Icon className="h-5 w-5" strokeWidth={selected ? 2.6 : 2} />
              <span>{item.label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
