'use client'

import Link from 'next/link'
import {
  ArrowRight,
  Browser,
  Cube,
  FileText,
  Lightning,
  Package,
  Eye,
  Play,
  CheckCircle,
  ArrowsOutSimple,
  ShieldCheck,
  Warning,
  TreeStructure,
  PuzzlePiece,
  AppWindow,
} from '@phosphor-icons/react/dist/ssr'
import { SiNodedotjs, SiBun, SiDeno, SiReact, SiCloudflare, SiGooglechrome, SiNpm, SiDocker, SiVuedotjs } from '@icons-pack/react-simple-icons'
import { SCENES } from './Scenes'
import FlowDiagram from '../diagrams/FlowDiagram'
import './developers.css'

/** Page banner: label, title, lede, optional install line, and the section's illustration. */
export function DevHero({ section = 'overview', eyebrow, title, children, install }) {
  const Scene = SCENES[section]
  return (
    <div className="lhd-hero lhd-card">
      <div className="lhd-hero-copy">
        {eyebrow && <span className="lhd-label">{eyebrow}</span>}
        <h1 className="lhd-title">{title}</h1>
        <div className="lhd-lede">{children}</div>
        {install && (
          <code className="lhd-install">
            <span>$</span>
            {install}
          </code>
        )}
      </div>
      {Scene && (
        <div className="lhd-art">
          <Scene />
        </div>
      )}
    </div>
  )
}

const PATHS = [
  {
    key: 'embed',
    href: '/developers/embed',
    kicker: 'No code',
    title: 'Embed',
    desc: 'Copy an iframe from any activity and paste it into a blog, a help center or a slide.',
  },
  {
    key: 'react',
    href: '/developers/react',
    kicker: 'React apps',
    title: 'React component',
    desc: 'Render activities in your own app with the same blocks LearnHouse uses, in your look.',
  },
  {
    key: 'sdk',
    href: '/developers/sdk',
    kicker: 'JavaScript & TypeScript',
    title: 'SDK',
    desc: 'A typed client for the API, from browsers and servers to React Native.',
  },
  {
    key: 'api',
    href: '/developers/api',
    kicker: 'Any language',
    title: 'REST API & webhooks',
    desc: 'Every endpoint with a live playground, and events sent to your server.',
  },
]

/** The four ways to build on LearnHouse. */
export function BuildPaths() {
  return (
    <div className="lhd-paths">
      {PATHS.map((p) => {
        const Scene = SCENES[p.key]
        return (
          <Link key={p.key} href={p.href} className="lhd-path lhd-card">
            <div className="lhd-art">
              <Scene />
            </div>
            <div className="lhd-path-body">
              <span className="lhd-label">{p.kicker}</span>
              <span className="lhd-path-title">
                {p.title}
                <ArrowRight size={15} weight="bold" />
              </span>
              <span className="lhd-path-desc">{p.desc}</span>
            </div>
          </Link>
        )
      })}
    </div>
  )
}

const QUESTIONS = [
  {
    q: 'You want an activity on a page whose code you don’t control',
    hint: 'A CMS, a blog, a help center, a slide deck',
    to: '/developers/embed',
    label: 'Embed',
  },
  {
    q: 'Your product is a React app and lessons should feel native in it',
    hint: 'Your fonts and colours, your routing, your analytics',
    to: '/developers/react',
    label: 'React component',
  },
  {
    q: 'You need data: courses, progress, users, or your own UI on top',
    hint: 'A server, a mobile app, a script, an edge function',
    to: '/developers/sdk',
    label: 'SDK',
  },
  {
    q: 'You don’t write JavaScript, or you need to react to events',
    hint: 'Python, Go, PHP… or a webhook when a learner finishes',
    to: '/developers/api',
    label: 'REST API',
  },
]

/** A short "which one do I need" list. */
export function PathPicker() {
  return (
    <div className="lhd-picker lhd-card">
      {QUESTIONS.map((item, i) => (
        <div key={item.to} className="lhd-q">
          <span className="lhd-q-num">{i + 1}</span>
          <span className="lhd-q-text">
            {item.q}
            <small>{item.hint}</small>
          </span>
          <Link href={item.to} className="lhd-q-answer">
            {item.label}
            <ArrowRight size={12} weight="bold" />
          </Link>
        </div>
      ))}
    </div>
  )
}

/** A real screenshot, framed like the app's cards. */
export function Screenshot({ src, alt, caption, url }) {
  return (
    <figure className="lhd-figure">
      <div className="lhd-shot lhd-card">
        <div className="lhd-shot-inner">
          <div className="lhd-shot-bar">
            <i />
            <i />
            <i />
            {url && <code>{url}</code>}
          </div>
          <img src={src} alt={alt} loading="lazy" />
        </div>
      </div>
      {caption && <figcaption>{caption}</figcaption>}
    </figure>
  )
}

export function Gallery({ children }) {
  return <div className="lhd-gallery">{children}</div>
}

const neutralNode = { color: '#404040', bg: '#fafafa', border: '#ececec' }

/** How a document becomes UI in the component and the embed. */
export function RendererPipeline() {
  return (
    <FlowDiagram
      nodes={[
        { label: 'Activity JSON', sub: 'What the editor saves', icon: FileText, ...neutralNode, edge: { label: 'static render' } },
        { label: 'LearnHouse blocks', sub: 'Quiz, flipcards, code, math… the editor’s own components', icon: PuzzlePiece, ...neutralNode, edge: { label: 'your theme' } },
        { label: 'Your page', sub: 'Embed or <LearnHouseActivity>', icon: AppWindow, ...neutralNode },
      ]}
      caption="No editor is started to show an activity: the saved document is turned straight into the same block components LearnHouse uses, and each block’s code loads only when the document contains that block."
    />
  )
}

/** How the npm packages are produced from the app's source. */
export function BuildPipeline() {
  return (
    <FlowDiagram
      nodes={[
        { label: 'LearnHouse source', sub: 'The web app’s renderer and the API schema', icon: TreeStructure, ...neutralNode, edge: { label: 'release tag' } },
        { label: 'Build & test', sub: 'Compiled, never copied', icon: Cube, ...neutralNode, edge: { label: 'publish' } },
        { label: 'npm', sub: '@learnhouse/sdk, @learnhouse/react and @learnhouse/vue', icon: Package, ...neutralNode },
      ]}
      caption="The packages are rebuilt from the release’s own source, so they can’t drift from the app they were released with."
    />
  )
}

/** One release tag, three artifacts with the same version. */
export function ReleaseLockstep({ version = '1.4.3' }) {
  const items = [
    { icon: SiDocker, name: 'ghcr.io/learnhouse/app', sub: 'Docker image' },
    { icon: SiNpm, name: '@learnhouse/sdk', sub: 'npm' },
    { icon: SiReact, name: '@learnhouse/react', sub: 'npm' },
    { icon: SiVuedotjs, name: '@learnhouse/vue', sub: 'npm' },
  ]
  return (
    <div className="lhd-release lhd-card">
      <div className="lhd-release-tag">
        <span className="lhd-label">Release</span>
        <strong>{version}</strong>
      </div>
      <div className="lhd-release-items">
        {items.map(({ icon: Icon, name, sub }) => (
          <div key={name} className="lhd-release-item">
            <span className="lhd-chip">
              <Icon size={15} color="#404040" />
            </span>
            <code>{name}</code>
            <span style={{ color: '#a3a3a3', fontSize: 12.5 }}>{sub}</span>
            <small>{version}</small>
          </div>
        ))}
      </div>
    </div>
  )
}

/** Where the SDK runs. */
export function RuntimeGrid() {
  const items = [
    { icon: SiGooglechrome, name: 'Browsers', sub: 'Cookie or token auth' },
    { icon: SiNodedotjs, name: 'Node 18+', sub: 'Servers, scripts, CI' },
    { icon: SiBun, name: 'Bun', sub: 'Same build' },
    { icon: SiDeno, name: 'Deno', sub: 'ESM import' },
    { icon: SiCloudflare, name: 'Edge workers', sub: 'fetch only, no Node APIs' },
    { icon: SiReact, name: 'React Native', sub: 'Hermes-safe' },
  ]
  return (
    <div className="lhd-grid">
      {items.map(({ icon: Icon, name, sub }) => (
        <div key={name} className="lhd-tile lhd-card">
          <span className="lhd-chip">
            <Icon size={16} color="#404040" />
          </span>
          <span>
            {name}
            <small>{sub}</small>
          </span>
        </div>
      ))}
    </div>
  )
}

/** API tokens stay on servers; browsers and apps use the learner's own token. */
export function AuthModes() {
  return (
    <div className="lhd-cols">
      <div className="lhd-panel lhd-card">
        <div className="lhd-panel-head">
          <span className="lhd-chip">
            <ShieldCheck size={17} weight="bold" />
          </span>
          On your server
        </div>
        <code style={{ alignSelf: 'flex-start' }}>{"createClient({ baseUrl, token: 'lh_…' })"}</code>
        <ul>
          <li>An org API token, from Dashboard → Developers → API Access.</li>
          <li>Acts on that org with the token’s permissions.</li>
          <li>Next.js route handlers, workers, scripts, CI.</li>
        </ul>
      </div>
      <div className="lhd-panel lhd-card">
        <div className="lhd-panel-head">
          <span className="lhd-chip">
            <Browser size={17} weight="bold" />
          </span>
          In a browser or app
        </div>
        <code style={{ alignSelf: 'flex-start' }}>{'createClient({ baseUrl, getToken })'}</code>
        <ul>
          <li>The signed-in learner’s access token, or their cookie session.</li>
          <li>Sees exactly what that learner can see.</li>
          <li>
            <Warning size={13} color="#b45309" weight="bold" style={{ verticalAlign: '-2px' }} /> Never ship an <code>lh_</code> token to a browser.
          </li>
        </ul>
      </div>
    </div>
  )
}

/** The order events reach onEvent. */
export function EventTimeline() {
  const steps = [
    { icon: Cube, name: 'load', sub: 'Activity fetched' },
    { icon: CheckCircle, name: 'ready', sub: 'First content painted' },
    { icon: Eye, name: 'visible', sub: 'Scrolled into view' },
    { icon: ArrowsOutSimple, name: 'resize', sub: 'Height changed' },
    { icon: Play, name: 'media', sub: 'Play, pause, progress' },
    { icon: Lightning, name: 'complete', sub: 'Reached the end' },
  ]
  return (
    <div className="lhd-timeline lhd-card">
      {steps.map(({ icon: Icon, name, sub }, i) => (
        <div key={name} className="lhd-tl-step">
          <span className="lhd-label">Step {i + 1}</span>
          <span className="lhd-chip">
            <Icon size={16} weight="bold" />
          </span>
          <code>{name}</code>
          <span className="lhd-tl-sub">{sub}</span>
        </div>
      ))}
    </div>
  )
}
