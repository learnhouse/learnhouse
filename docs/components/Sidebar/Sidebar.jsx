'use client'

import { useConfig } from 'nextra-theme-docs'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import {
  House,
  RocketLaunch,
  Lightning,
  Cloud,
  AppWindow,
  BookOpen,
  PencilSimple,
  Brain,
  Users,
  Buildings,
  GraduationCap,
  ChalkboardTeacher,
  Stack,
  Path,
  Cube,
  UsersThree,
  DownloadSimple,
  Gear,
  Wrench,
  ListChecks,
  Terminal,
  TreeStructure,
  GitBranch,
  Plug,
  Browser,
  Database,
  HardDrives,
  Key,
  Envelope,
  Folder,
  Lock,
  ArrowsClockwise,
  ClockCountdown,
  ChartBar,
  Lifebuoy,
  ShieldCheck,
  Code,
  BookBookmark,
  SlidersHorizontal,
  ClipboardText,
  Trophy,
  CheckCircle,
  GameController,
  ChatCircle,
  ChatDots,
  ThumbsUp,
  Kanban,
  ChalkboardSimple,
  Microphone,
  MagnifyingGlass,
  Certificate,
  Briefcase,
  CreditCard,
  Storefront,
  ShoppingCart,
  Receipt,
  IdentificationBadge,
  Package,
  Scroll,
} from '@phosphor-icons/react/dist/ssr'

const ICON_SIZE = 15

const iconMap = {
  // Root level
  '/': House,
  '/getting-started': RocketLaunch,
  '/platform': AppWindow,
  '/enterprise': Briefcase,
  '/self-hosting': Cloud,
  '/developers': Code,

  // Getting Started
  '/getting-started/quickstart': Lightning,
  '/getting-started/cloud-vs-self-hosting': Cloud,
  '/getting-started/key-concepts': BookOpen,

  // Platform
  '/platform/courses': BookBookmark,
  '/platform/editor': PencilSimple,
  '/platform/ai': Brain,
  '/platform/users': Users,
  '/platform/organizations': Buildings,

  // Platform > Courses
  '/platform/courses/chapters-and-activities': Stack,
  '/platform/courses/collections': Folder,
  '/platform/courses/trails': Path,

  // Platform > Editor
  '/platform/editor/blocks': Cube,

  // Platform > AI
  '/platform/ai/for-students': GraduationCap,
  '/platform/ai/for-teachers': ChalkboardTeacher,

  // Platform > Users
  '/platform/users/roles-and-permissions': ShieldCheck,
  '/platform/users/authentication': Key,

  // Platform > Assignments
  '/platform/assignments': ClipboardText,
  '/platform/assignments/grading': CheckCircle,

  // Platform > Code Execution
  '/platform/code-execution': Terminal,

  // Platform > Playgrounds
  '/platform/playgrounds': GameController,

  // Platform > Discussions
  '/platform/discussions': ChatCircle,
  '/platform/discussions/comments': ChatDots,

  // Platform > Boards
  '/platform/boards': ChalkboardSimple,

  // Platform > Podcasts
  '/platform/podcasts': Microphone,

  // Platform > Certifications
  '/platform/certifications': Certificate,

  // Platform > Analytics
  '/platform/analytics': ChartBar,

  // Platform > Search
  '/platform/search': MagnifyingGlass,

  // Platform > Payments
  '/platform/payments': CreditCard,
  '/platform/payments/offers': Storefront,
  '/platform/payments/groups': ShoppingCart,
  '/platform/payments/enrollments': Receipt,

  // Platform > Organizations
  '/platform/organizations/multi-tenancy': TreeStructure,
  '/platform/organizations/settings': SlidersHorizontal,

  // Platform > Automations
  '/platform/automations': Lightning,
  '/platform/automations/webhooks': Plug,
  '/platform/automations/zapier': ArrowsClockwise,
  '/platform/automations/events': ListChecks,

  // Enterprise
  '/enterprise/sso': IdentificationBadge,
  '/enterprise/audit-logs': Scroll,
  '/enterprise/scorm': Package,

  // Self Hosting
  '/self-hosting/installation': DownloadSimple,
  '/self-hosting/configuration': Gear,
  '/self-hosting/maintenance': Wrench,

  // Self Hosting > Installation
  '/self-hosting/installation/requirements': ListChecks,
  '/self-hosting/installation/quick-install': Lightning,
  '/self-hosting/installation/cli-reference': Terminal,

  // Self Hosting > Configuration
  '/self-hosting/configuration/environment-variables': Code,
  '/self-hosting/configuration/ai-setup': Brain,
  '/self-hosting/configuration/email': Envelope,
  '/self-hosting/configuration/storage': HardDrives,
  '/self-hosting/configuration/ssl': Lock,

  // Self Hosting > Maintenance
  '/self-hosting/maintenance/updates': ArrowsClockwise,
  '/self-hosting/maintenance/backups': ClockCountdown,
  '/self-hosting/maintenance/monitoring': ChartBar,
  '/self-hosting/maintenance/troubleshooting': Lifebuoy,

  // CLI
  '/cli': Terminal,
  '/cli/commands': ListChecks,
  '/cli/setup-wizard': Lightning,
  '/cli/dev-mode': Code,
  '/cli/environment-variables': Gear,

  // Developers
  '/developers/architecture': TreeStructure,
  '/developers/contributing': GitBranch,
  '/developers/api': Plug,
  '/developers/migration': ArrowsClockwise,

  // Developers > Architecture
  '/developers/architecture/frontend': Browser,
  '/developers/architecture/backend': Database,
  '/developers/architecture/services': HardDrives,

  // Developers > Contributing
  '/developers/contributing/dev-environment': Terminal,
  '/developers/contributing/guidelines': BookOpen,

  // Developers > API
  '/developers/api/authentication': Key,
  '/developers/api/endpoints': Plug,

  // Developers > Migration
  '/developers/migration/programmatic': Code,
  '/developers/migration/activity-types': Stack,
  '/developers/migration/assisted': Brain,
}

function getIcon(route) {
  const Icon = iconMap[route]
  if (!Icon) return null
  return <Icon size={ICON_SIZE} weight="fill" />
}

function SidebarItem({ item, depth = 0, onNavigate }) {
  const pathname = usePathname()
  const isActive = pathname === item.route
  const hasChildren = item.children && item.children.length > 0
  const isChildActive = hasChildren && item.children.some(
    child => pathname === child.route || pathname?.startsWith(child.route + '/')
  )
  const [open, setOpen] = useState(isChildActive || depth < 1)

  useEffect(() => {
    if (isChildActive) setOpen(true)
  }, [isChildActive])

  if (item.type === 'separator') {
    return (
      <div className="lh-sidebar-separator">
        {typeof item.title === 'string' ? item.title : item.name}
      </div>
    )
  }

  if (item.display === 'hidden') return null

  const title = typeof item.title === 'string'
    ? item.title
    : typeof item.title === 'object' && item.title
      ? item.title
      : item.name

  const icon = getIcon(item.route)

  if (hasChildren) {
    return (
      <div className="lh-sidebar-folder">
        <button
          className={`lh-sidebar-folder-btn ${isChildActive ? 'lh-sidebar-folder-active' : ''}`}
          onClick={() => setOpen(!open)}
          style={{ paddingLeft: 10 }}
        >
          <span className="lh-sidebar-folder-title">
            {icon && <span className="lh-sidebar-icon">{icon}</span>}
            {title}
          </span>
          <svg
            className={`lh-sidebar-chevron ${open ? 'lh-sidebar-chevron-open' : ''}`}
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
        {open && (
          <div className="lh-sidebar-children">
            {item.children.map((child, i) => (
              <SidebarItem key={child.route || i} item={child} depth={depth + 1} onNavigate={onNavigate} />
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <Link
      href={item.route || '#'}
      className={`lh-sidebar-link ${isActive ? 'lh-sidebar-link-active' : ''}`}
      style={{ paddingLeft: 10 }}
      onClick={onNavigate}
    >
      {icon && <span className="lh-sidebar-icon">{icon}</span>}
      {title}
    </Link>
  )
}

function SidebarContent({ onNavigate }) {
  const config = useConfig()
  const pathname = usePathname()
  const { docsDirectories } = config.normalizePagesResult

  const isDevSection = pathname?.startsWith('/developers') || pathname?.startsWith('/self-hosting') || pathname?.startsWith('/cli') || pathname?.startsWith('/enterprise')

  const devRoutes = ['/developers', '/self-hosting', '/cli', '/enterprise']
  const items = docsDirectories.filter((item) => {
    const isDev = devRoutes.some(r => item.route?.startsWith(r))
    return isDevSection ? isDev : !isDev
  })

  // Enforce sidebar order for dev section
  const devOrder = ['/developers', '/cli', '/self-hosting', '/enterprise']
  items.sort((a, b) => {
    const aIdx = devOrder.indexOf(a.route)
    const bIdx = devOrder.indexOf(b.route)
    if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx
    if (aIdx !== -1) return -1
    if (bIdx !== -1) return 1
    return 0
  })

  return (
    <nav className="lh-sidebar-nav">
      {items.map((item, i) => (
        <SidebarItem key={item.route || i} item={item} depth={0} onNavigate={onNavigate} />
      ))}
    </nav>
  )
}

function MobileSidebarPortal({ onNavigate }) {
  const [mountNode, setMountNode] = useState(null)

  useEffect(() => {
    const el = document.getElementById('mobile-sidebar-mount')
    if (el) setMountNode(el)
  }, [])

  if (!mountNode) return null

  return createPortal(<SidebarContent onNavigate={onNavigate} />, mountNode)
}

export default function Sidebar() {
  return (
    <>
      {/* Desktop sidebar */}
      <aside className="lh-sidebar">
        <SidebarContent />
      </aside>

      {/* Portal into mobile drawer */}
      <MobileSidebarPortal />
    </>
  )
}
