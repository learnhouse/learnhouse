import Link from 'next/link'
import { Buildings, BookOpen, ListBullets, FileText, ArrowRight } from '@phosphor-icons/react/dist/ssr'
import { TABS } from '../site/sections'
import './home.css'

const CONCEPTS = [
  { icon: Buildings, title: 'Organization', text: 'Your academy: its branding, members, roles and settings.' },
  { icon: BookOpen, title: 'Course', text: 'What learners enroll in. Public or private, free or paid.' },
  { icon: ListBullets, title: 'Chapter', text: 'Groups the lessons of a course in order.' },
  { icon: FileText, title: 'Activity', text: 'One lesson: a page with blocks, a video, a PDF, an assignment.' },
]

/** Organization → Course → Chapter → Activity, as a row of cards. */
export function ConceptMap() {
  return (
    <div className="lhh-concepts">
      {CONCEPTS.map(({ icon: Icon, title, text }, i) => (
        <div key={title} className="lhh-concept">
          <div className="lhh-concept-head">
            <span className="lhh-chip lhh-chip-sm">
              <Icon size={15} weight="bold" />
            </span>
            {i < CONCEPTS.length - 1 && <ArrowRight className="lhh-concept-arrow" size={14} weight="bold" />}
          </div>
          <span className="lhh-topic-title">{title}</span>
          <span className="lhh-topic-text">{text}</span>
        </div>
      ))}
    </div>
  )
}

const DESCRIPTIONS = {
  start: 'This section: first steps, key concepts, and guides that walk through whole projects.',
  platform: 'Using LearnHouse: courses, the editor, AI, users, payments, and the Enterprise Edition.',
  'self-hosting': 'Installing, configuring, updating and backing up your own instance, and the CLI.',
  developers: 'Building on LearnHouse: embeds, the React and Vue components, the SDK, the REST API and webhooks.',
  demos: 'Fifty apps built on the API, live, with the code to start from.',
  reference: 'Every API endpoint, with examples in your language and a live playground.',
  releases: 'What changed in each version of LearnHouse, the CLI and the packages.',
}

/** The navbar tabs, each with a one-line description. */
export function DocsMap() {
  return (
    <div className="lhh-docsmap">
      {TABS.map((tab) => (
        <Link key={tab.key} href={tab.href} className="lhh-docsmap-row">
          <span className="lhh-topic-title">{tab.label}</span>
          <span className="lhh-topic-text">{DESCRIPTIONS[tab.key]}</span>
          <ArrowRight size={13} weight="bold" />
        </Link>
      ))}
    </div>
  )
}
