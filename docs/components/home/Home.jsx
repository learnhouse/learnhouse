import Link from 'next/link'
import {
  ArrowRight,
  Cloud,
  HardDrives,
  Code,
  BookOpen,
  PencilSimpleLine,
  Sparkle,
  Users,
  CreditCard,
  GearSix,
  ArrowsClockwise,
  BracketsCurly,
  Tag,
  GithubLogo,
  DiscordLogo,
  GraduationCap,
} from '@phosphor-icons/react/dist/ssr'
import './home.css'

const START = [
  {
    href: '/getting-started/quickstart#option-a-learnhouse-cloud',
    icon: Cloud,
    label: 'Fastest',
    title: 'Use LearnHouse Cloud',
    text: 'Create your academy in a few minutes. Hosting, updates and backups are handled for you.',
    action: 'Start with Cloud',
  },
  {
    href: '/self-hosting/installation/quick-install',
    icon: HardDrives,
    label: 'Your servers',
    title: 'Self-host it',
    text: 'One command sets up LearnHouse on any machine with Docker.',
    code: 'npx learnhouse@latest setup',
    action: 'Install guide',
  },
  {
    href: '/developers',
    icon: Code,
    label: 'Headless',
    title: 'Build on LearnHouse',
    text: 'Embed lessons, render them in React, or drive everything from the API and SDK.',
    action: 'Developer docs',
  },
]

const TOPICS = [
  { href: '/platform/courses', icon: BookOpen, title: 'Courses', text: 'Chapters, activities, publishing' },
  { href: '/platform/editor', icon: PencilSimpleLine, title: 'Editor', text: 'Blocks, quizzes, collaboration' },
  { href: '/platform/ai', icon: Sparkle, title: 'AI', text: 'Tutoring and course assistants' },
  { href: '/platform/users', icon: Users, title: 'Users & roles', text: 'Permissions, groups, sign-in' },
  { href: '/platform/payments', icon: CreditCard, title: 'Payments', text: 'Sell courses and memberships' },
  { href: '/self-hosting/configuration', icon: GearSix, title: 'Configuration', text: 'Domains, email, storage, AI keys' },
  { href: '/self-hosting/maintenance/updates', icon: ArrowsClockwise, title: 'Updates & backups', text: 'Keep an instance current' },
  { href: '/reference', icon: BracketsCurly, title: 'API reference', text: 'Every endpoint, with a playground' },
]

export function HomeHero({ version, date }) {
  return (
    <section className="lhh-hero">
      <span className="lhh-label">LearnHouse documentation</span>
      <h1 className="lhh-title">Run your academy. Build anything on top.</h1>
      <p className="lhh-lede">
        Guides for teaching on LearnHouse, running your own instance, and building with its API, SDK and components.
      </p>
      {version && (
        <Link href="/releases" className="lhh-release">
          <Tag size={13} weight="bold" />
          <span>
            Latest release <strong>v{version}</strong>
            {date && <> · {date}</>}
          </span>
          <ArrowRight size={12} weight="bold" />
        </Link>
      )}
    </section>
  )
}

export function StartPaths() {
  return (
    <div className="lhh-start">
      {START.map(({ href, icon: Icon, label, title, text, code, action }) => (
        <Link key={href} href={href} className="lhh-start-card">
          <span className="lhh-chip">
            <Icon size={18} weight="bold" />
          </span>
          <span className="lhh-label">{label}</span>
          <span className="lhh-start-title">{title}</span>
          <span className="lhh-start-text">{text}</span>
          {code && <code className="lhh-start-code">{code}</code>}
          <span className="lhh-start-action">
            {action}
            <ArrowRight size={13} weight="bold" />
          </span>
        </Link>
      ))}
    </div>
  )
}

export function TopicGrid() {
  return (
    <div className="lhh-topics">
      {TOPICS.map(({ href, icon: Icon, title, text }) => (
        <Link key={href} href={href} className="lhh-topic">
          <span className="lhh-chip lhh-chip-sm">
            <Icon size={15} weight="bold" />
          </span>
          <span>
            <span className="lhh-topic-title">{title}</span>
            <span className="lhh-topic-text">{text}</span>
          </span>
        </Link>
      ))}
    </div>
  )
}

export function CommunityRow() {
  const items = [
    { href: 'https://github.com/learnhouse/learnhouse', icon: GithubLogo, title: 'GitHub', text: 'Source, issues and discussions' },
    { href: 'https://discord.gg/CMyZjjYZ6x', icon: DiscordLogo, title: 'Discord', text: 'Ask the team and the community' },
    { href: 'https://university.learnhouse.io', icon: GraduationCap, title: 'LearnHouse University', text: 'Video courses on using LearnHouse' },
  ]
  return (
    <div className="lhh-community">
      {items.map(({ href, icon: Icon, title, text }) => (
        <a key={href} href={href} target="_blank" rel="noopener noreferrer" className="lhh-topic">
          <span className="lhh-chip lhh-chip-sm">
            <Icon size={15} weight="fill" />
          </span>
          <span>
            <span className="lhh-topic-title">{title}</span>
            <span className="lhh-topic-text">{text}</span>
          </span>
        </a>
      ))}
    </div>
  )
}
