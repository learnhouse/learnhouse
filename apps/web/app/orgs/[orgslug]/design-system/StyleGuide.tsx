'use client'
// Dev-only style guide (see page.tsx). English only on purpose: it never ships.
import React from 'react'
import {
  BookOpen,
  ChartBar,
  CheckCircle,
  Copy,
  Eye,
  FunnelSimple,
  Gear,
  House,
  Info,
  Lock,
  PencilSimple,
  Plus,
  Trash,
  Users,
  WarningCircle,
} from '@phosphor-icons/react'
import {
  AI_DARK_SURFACE,
  AIAvatar,
  AIButton,
  AIChip,
  AIMark,
  AISurfaceHeader,
  AIShimmer,
  AIThinking,
  AvatarStack,
  BulkActionBar,
  BulkActionButton,
  Button,
  Chip,
  ChoiceCard,
  ConfirmDialog,
  DashPage,
  DashPageHeader,
  EmptyState,
  Eyebrow,
  FieldLabel,
  INPUT,
  OptionCard,
  Panel,
  SearchInput,
  SectionCard,
  SegmentedControl,
  SettingRow,
  Skeleton,
  StatCard,
  StatusDot,
  StatusPill,
  StickySaveBar,
  SubTabPanel,
  SubTabs,
  TEXTAREA,
  Toolbar,
  ToolbarSelect,
  ViewToggle,
  aiSurface,
  buttonClass,
  recipes,
  tokens,
  type ButtonSize,
  type ButtonVariant,
  type ChipTone,
  type Status,
  type ViewMode,
} from '@/design'
import { DEFAULT_THEME_OPTIONS, PALETTE, themeRootProps } from '@/lib/theme/orgTheme'

const SECTIONS = [
  ['colors', 'Color roles'],
  ['accent', 'Org accent'],
  ['type', 'Type'],
  ['shape', 'Radius & shadow'],
  ['spacing', 'Spacing & motion'],
  ['icons', 'Icons'],
  ['charts', 'Charts'],
  ['buttons', 'Buttons'],
  ['labels', 'Chips & status'],
  ['controls', 'Controls'],
  ['layout', 'Page grammar'],
  ['forms', 'Forms & settings'],
  ['states', 'Empty, loading, error'],
  ['ai', 'AI branding'],
  ['dark', 'Dark surfaces'],
] as const

const COLOR_GROUPS: { title: string; keys: (keyof typeof tokens.color)[] }[] = [
  { title: 'Canvas & surfaces', keys: ['canvas', 'canvas-reading', 'surface', 'surface-muted', 'surface-sunken', 'track', 'border', 'border-strong'] },
  { title: 'Text', keys: ['fg', 'fg-secondary', 'fg-muted', 'fg-subtle'] },
  { title: 'Dark surfaces', keys: ['ink', 'ink-reading', 'ink-ai'] },
  { title: 'Org accent (neutral outside a theme root)', keys: ['accent', 'accent-hover', 'accent-contrast', 'accent-soft', 'accent-ink'] },
  {
    title: 'Status',
    keys: ['success', 'success-soft', 'success-ink', 'warning', 'warning-soft', 'warning-ink', 'dirty', 'danger', 'danger-soft', 'danger-ink', 'info', 'info-soft', 'info-ink'],
  },
  { title: 'AI (reserved)', keys: ['ai', 'ai-soft', 'ai-ink'] },
]

function Section({ id, title, intro, children }: { id: string; title: string; intro?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-6 flex flex-col gap-4">
      <div>
        <h2 className="text-xl font-bold tracking-tight text-neutral-900">{title}</h2>
        {intro && <p className="mt-1 text-sm text-neutral-500 max-w-2xl">{intro}</p>}
      </div>
      {children}
    </section>
  )
}

function Code({ children }: { children: React.ReactNode }) {
  return <code className="rounded-md bg-neutral-100 px-1.5 py-0.5 text-[11px] font-mono text-neutral-700 break-all">{children}</code>
}

function Swatch({ name }: { name: keyof typeof tokens.color }) {
  const tok = tokens.color[name]
  return (
    <div className="flex items-center gap-3 min-w-0">
      <div className="w-11 h-11 rounded-xl shrink-0 ring-1 ring-inset ring-black/10" style={{ background: tok.value }} />
      <div className="min-w-0">
        <p className="text-sm font-semibold text-neutral-900 truncate">{name}</p>
        <p className="text-[11px] text-neutral-500 truncate" title={tok.use}>
          {tok.use}
        </p>
        <p className="text-[11px] font-mono text-neutral-400 truncate">{tok.tailwind}</p>
      </div>
    </div>
  )
}

const BUTTON_VARIANTS: ButtonVariant[] = ['primary', 'secondary', 'ghost', 'danger', 'danger-ghost']
const BUTTON_SIZES = ['sm', 'md', 'lg'] as const satisfies readonly ButtonSize[]
const CHIP_TONES: ChipTone[] = ['neutral', 'amber', 'emerald', 'rose', 'sky', 'violet']
const STATUSES: { status: Status; label: string }[] = [
  { status: 'success', label: 'Published' },
  { status: 'warning', label: 'Draft' },
  { status: 'danger', label: 'Failed' },
  { status: 'info', label: 'Scheduled' },
  { status: 'neutral', label: 'Archived' },
  { status: 'ai', label: 'Generated' },
]

export default function StyleGuide() {
  const [accent, setAccent] = React.useState<string>(PALETTE[1])
  const [segment, setSegment] = React.useState<'all' | 'published' | 'drafts'>('all')
  const [view, setView] = React.useState<ViewMode>('grid')
  const [query, setQuery] = React.useState('')
  const [sort, setSort] = React.useState('recent')
  const [pillTab, setPillTab] = React.useState('general')
  const [sideTab, setSideTab] = React.useState('general')
  const [choice, setChoice] = React.useState<'public' | 'private'>('public')
  const [confirmOpen, setConfirmOpen] = React.useState(false)
  const [bulk, setBulk] = React.useState(false)
  const [dirty, setDirty] = React.useState(false)

  const themed = themeRootProps({
    color: accent,
    font: '',
    theme: { ...DEFAULT_THEME_OPTIONS, accent_mode: 'custom', accent_color: accent, background: 'plain' },
  })

  const subTabItems = [
    { key: 'general', label: 'General', icon: <Info size={15} /> },
    { key: 'access', label: 'Access', icon: <Lock size={15} />, dirty: true },
    { key: 'people', label: 'People', icon: <Users size={15} />, badge: <Chip>3</Chip> },
    { key: 'advanced', label: 'Advanced', icon: <Gear size={15} /> },
  ]

  return (
    <div className="min-h-screen bg-[#f8f8f8]">
      <DashPage className="max-w-6xl mx-auto">
        <DashPageHeader
          breadcrumbs={[{ label: 'Dev', href: '#' }, { label: 'Design system', href: '#' }]}
          title="LearnHouse V2 design system"
          subtitle={
            <>
              Every token and primitive from <Code>@/design</Code>. Rules live in <Code>apps/web/design/DESIGN.md</Code>. Development only.
            </>
          }
        />

        <nav aria-label="Sections" className="flex flex-wrap gap-1.5">
          {SECTIONS.map(([id, label]) => (
            <a key={id} href={`#${id}`} className={buttonClass('secondary', 'sm')}>
              {label}
            </a>
          ))}
        </nav>

        <Section id="colors" title="Color roles" intro="Tailwind utilities: bg-lh-*, text-lh-*, ring-lh-*, border-lh-*. Existing pages use the palette class shown under each swatch; both resolve to the same color.">
          <div className="grid gap-4 lg:grid-cols-2">
            {COLOR_GROUPS.map((group) => (
              <Panel key={group.title} padded>
                <Eyebrow className="mb-3">{group.title}</Eyebrow>
                <div className="grid gap-3 sm:grid-cols-2">
                  {group.keys.map((key) => (
                    <Swatch key={key} name={key} />
                  ))}
                </div>
              </Panel>
            ))}
          </div>
        </Section>

        <Section
          id="accent"
          title="Org accent"
          intro="Inside an org theme root (.lh-theme + themeRootProps), lh-t-* markers and the accent tokens follow the org color. The dashboard has no theme root and stays neutral."
        >
          <Panel padded className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              {PALETTE.map((hex) => (
                <button
                  key={hex}
                  type="button"
                  onClick={() => setAccent(hex)}
                  aria-label={`Accent ${hex}`}
                  aria-pressed={accent === hex}
                  className={`w-7 h-7 rounded-full ring-offset-2 ${accent === hex ? 'ring-2 ring-neutral-900' : 'ring-1 ring-black/10'}`}
                  style={{ background: hex }}
                />
              ))}
              <Code>{accent}</Code>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-xl ring-1 ring-inset ring-neutral-200 p-4 flex flex-col gap-3">
                <Eyebrow>Dashboard (no theme root)</Eyebrow>
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="primary">Primary</Button>
                  <span className="inline-flex items-center h-7 px-2.5 rounded-full text-xs font-semibold bg-lh-accent-soft text-lh-accent-ink">accent-soft</span>
                  <span className="text-sm font-semibold text-lh-accent-ink">accent-ink</span>
                </div>
                <div className="h-1.5 rounded-full bg-neutral-100 overflow-hidden">
                  <div className="h-full w-2/3 bg-lh-accent" />
                </div>
              </div>
              <div className="lh-theme rounded-xl ring-1 ring-inset ring-neutral-200 p-4 flex flex-col gap-3 bg-white" style={themed.style} {...themed.attrs}>
                <Eyebrow>Learner page (theme root)</Eyebrow>
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="primary">Primary</Button>
                  <span className="lh-t-chip inline-flex items-center h-7 px-2.5 rounded-full text-xs font-semibold bg-neutral-100 text-neutral-700 ring-1 ring-inset">lh-t-chip</span>
                  <span className="text-sm font-semibold text-lh-accent-ink">accent-ink</span>
                </div>
                <div className="h-1.5 rounded-full bg-neutral-100 overflow-hidden">
                  <div className="lh-t-progress h-full w-2/3 bg-teal-500" />
                </div>
              </div>
            </div>
          </Panel>
        </Section>

        <Section id="type" title="Type" intro="One family (Wix Madefor Text; Tajawal for Arabic; the org font on learner pages). semibold is the default UI weight; bold is for page titles and stat values; tabular-nums on every number.">
          <Panel divided>
            {Object.entries(tokens.text).map(([key, tok]) => (
              <div key={key} className="flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-6 px-5 py-3">
                <div className="sm:w-48 shrink-0">
                  <p className="text-xs font-semibold text-neutral-900">
                    {key} <span className="font-normal text-neutral-400">{tok.value}</span>
                  </p>
                  <p className="text-[11px] font-mono text-neutral-400">{tok.tailwind}</p>
                </div>
                <p className="min-w-0 text-neutral-900 truncate" style={{ fontSize: tok.value }}>
                  {tok.use}
                </p>
              </div>
            ))}
          </Panel>
        </Section>

        <Section id="shape" title="Radius & shadow" intro="Controls are rounded-lg (h-7) or rounded-xl (h-8/h-9); every card is rounded-2xl with nice-shadow. Buttons carry a hairline relief, never a drop shadow.">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Object.entries(tokens.radius).map(([key, tok]) => (
              <Panel key={key} padded className="flex flex-col gap-3">
                <div className="h-14 bg-neutral-100 ring-1 ring-inset ring-neutral-200" style={{ borderRadius: tok.value }} />
                <div>
                  <p className="text-sm font-semibold text-neutral-900">
                    {key} <span className="font-normal text-neutral-400">{tok.value}</span>
                  </p>
                  <p className="text-[11px] font-mono text-neutral-400">{tok.tailwind}</p>
                  <p className="text-xs text-neutral-500 mt-1">{tok.use}</p>
                </div>
              </Panel>
            ))}
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Object.entries(tokens.shadow).map(([key, tok]) => (
              <div key={key} className="flex flex-col gap-3 rounded-2xl bg-neutral-50 p-5">
                <div
                  className={`h-14 rounded-xl bg-white ${key === 'card' ? 'nice-shadow' : ''}`}
                  style={'cssVar' in tok ? { boxShadow: tok.value } : undefined}
                />
                <div>
                  <p className="text-sm font-semibold text-neutral-900">{key}</p>
                  <p className="text-[11px] font-mono text-neutral-400">{tok.tailwind}</p>
                  <p className="text-xs text-neutral-500 mt-1">{tok.use}</p>
                </div>
              </div>
            ))}
          </div>
        </Section>

        <Section id="spacing" title="Spacing & motion">
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel padded className="flex flex-col gap-3">
              <Eyebrow>Spacing rhythm</Eyebrow>
              {Object.entries(tokens.spacing).map(([key, tok]) => (
                <div key={key} className="flex items-center gap-3">
                  <div className="h-3 rounded-sm bg-neutral-900 shrink-0" style={{ width: tok.value }} />
                  <p className="text-sm text-neutral-900 min-w-0">
                    <span className="font-semibold">{key}</span> <span className="text-neutral-400">{tok.value}</span>{' '}
                    <span className="text-[11px] font-mono text-neutral-400">{tok.tailwind}</span>
                    <span className="block text-xs text-neutral-500">{tok.use}</span>
                  </p>
                </div>
              ))}
            </Panel>
            <Panel padded className="flex flex-col gap-3">
              <Eyebrow>Motion</Eyebrow>
              {Object.entries(tokens.motion).map(([key, tok]) => (
                <div key={key} className="text-sm text-neutral-900">
                  <span className="font-semibold">{key}</span> <Code>{tok.value}</Code>{' '}
                  <span className="text-[11px] font-mono text-neutral-400">{tok.tailwind}</span>
                  <span className="block text-xs text-neutral-500">{tok.use}</span>
                </div>
              ))}
              <Eyebrow className="mt-2">Control heights</Eyebrow>
              <div className="flex flex-wrap items-end gap-2">
                {BUTTON_SIZES.map((size) => (
                  <Button key={size} size={size}>
                    {size} · {tokens.layout.controlHeights[size].split(' ')[0]}
                  </Button>
                ))}
              </div>
              <Eyebrow className="mt-2">Z-index (selected layers)</Eyebrow>
              <div className="flex flex-wrap gap-1.5">
                {(['sticky', 'nav', 'dropdown', 'modal', 'popover', 'toast'] as const).map((key) => (
                  <Chip key={key}>
                    {key} {tokens.zIndex[key]}
                  </Chip>
                ))}
              </div>
            </Panel>
          </div>
        </Section>

        <Section id="icons" title="Icons" intro="Phosphor only. Regular weight by default, bold for 12px glyphs, fill for active/status, directional icons flip with rtl:rotate-180.">
          <Panel padded className="flex flex-wrap gap-6">
            {Object.entries(tokens.icon.sizes).map(([size, use]) => (
              <div key={size} className="flex flex-col items-center gap-2 w-28 text-center">
                <BookOpen size={Number(size)} weight={Number(size) <= 12 ? 'bold' : 'regular'} className="text-neutral-700" />
                <p className="text-xs font-semibold text-neutral-900">{size}px</p>
                <p className="text-[11px] text-neutral-500">{use}</p>
              </div>
            ))}
          </Panel>
        </Section>

        <Section id="charts" title="Charts" intro="Fixed assignment order, never cycled: past four series, fold the rest into Other. Blue is the default single series.">
          <Panel padded className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-3">
              {tokens.chartSeries.map((hex, i) => (
                <div key={hex} className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-md" style={{ background: hex }} />
                  <span className="text-xs text-neutral-600 tabular-nums">
                    {i + 1} <span className="font-mono text-neutral-400">{hex}</span>
                  </span>
                </div>
              ))}
            </div>
            <div className="flex items-end gap-1.5 h-32 border-b" style={{ borderColor: tokens.color['chart-grid'].value }}>
              {[38, 62, 45, 80, 56, 92, 70, 64, 85, 50, 74, 96].map((v, i) => (
                <div key={i} className="flex-1 flex items-end gap-0.5 h-full">
                  <div className="flex-1 rounded-t-sm" style={{ height: `${v * 0.7}%`, background: tokens.color['chart-previous'].value }} />
                  <div className="flex-1 rounded-t-sm" style={{ height: `${v}%`, background: tokens.chartSeries[0] }} />
                </div>
              ))}
            </div>
            <p className="text-[11px]" style={{ color: tokens.color['chart-axis'].value }}>
              Current period in series 1, previous period in chart-previous, grid in chart-grid, axis text in chart-axis.
            </p>
          </Panel>
        </Section>

        <Section id="buttons" title="Buttons" intro="<Button variant size icon loading> or buttonClass() on links. One primary per view.">
          <Panel padded className="flex flex-col gap-4 overflow-x-auto">
            {BUTTON_VARIANTS.map((variant) => (
              <div key={variant} className="flex flex-wrap items-center gap-2">
                <span className="w-24 text-xs font-semibold text-neutral-500">{variant}</span>
                {BUTTON_SIZES.map((size) => (
                  <Button key={size} variant={variant} size={size} icon={<Plus size={size === 'sm' ? 12 : 14} weight="bold" />}>
                    New course
                  </Button>
                ))}
                <Button variant={variant} size="icon" aria-label="Edit">
                  <PencilSimple size={14} />
                </Button>
                <Button variant={variant} loading>
                  Saving
                </Button>
                <Button variant={variant} disabled>
                  Disabled
                </Button>
              </div>
            ))}
          </Panel>
        </Section>

        <Section id="labels" title="Chips & status" intro="Chip picks a hue; StatusPill picks a meaning and maps it to the hue. Violet means AI.">
          <Panel padded className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-2">
              {CHIP_TONES.map((tone) => (
                <Chip key={tone} tone={tone}>
                  {tone}
                </Chip>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              {STATUSES.map(({ status, label }) => (
                <StatusPill key={status} status={status} dot>
                  {label}
                </StatusPill>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-4 text-sm text-neutral-700">
              {STATUSES.map(({ status, label }) => (
                <span key={status} className="inline-flex items-center gap-2">
                  <StatusDot status={status} />
                  {label}
                </span>
              ))}
            </div>
            <div className="flex items-center gap-3">
              <AvatarStack
                people={[
                  { key: 'a', src: '', label: 'Ada' },
                  { key: 'b', src: '', label: 'Brian' },
                  { key: 'c', src: '', label: 'Chen' },
                  { key: 'd', src: '', label: 'Dana' },
                  { key: 'e', src: '', label: 'Eli' },
                ]}
              />
              <span className="text-xs text-neutral-500">AvatarStack</span>
            </div>
          </Panel>
        </Section>

        <Section id="controls" title="Controls" intro="SearchInput (with the / shortcut), ToolbarSelect, SegmentedControl, ViewToggle and SubTabs share the grey track and the white selected pill.">
          <Panel padded className="flex flex-col gap-5">
            <Toolbar
              end={
                <>
                  <ToolbarSelect
                    value={sort}
                    onChange={setSort}
                    ariaLabel="Sort"
                    icon={<FunnelSimple size={14} />}
                    options={[
                      { value: 'recent', label: 'Recently updated' },
                      { value: 'name', label: 'Name' },
                    ]}
                  />
                  <ViewToggle value={view} onChange={setView} />
                </>
              }
            >
              <SearchInput value={query} onChange={setQuery} placeholder="Search courses" className="xl:max-w-md" />
            </Toolbar>
            <SegmentedControl
              value={segment}
              onChange={setSegment}
              ariaLabel="Filter"
              options={[
                { key: 'all', label: 'All', count: 24 },
                { key: 'published', label: 'Published', count: 18 },
                { key: 'drafts', label: 'Drafts', count: 6 },
              ]}
            />
            <div className="flex flex-col gap-2">
              <Eyebrow>SubTabs, pills</Eyebrow>
              <SubTabs items={subTabItems} value={pillTab} onChange={setPillTab} idPrefix="ds-pills" ariaLabel="Pills demo">
                <SubTabPanel tab={pillTab}>
                  <p className="text-sm text-neutral-500">Panel: {pillTab}</p>
                </SubTabPanel>
              </SubTabs>
            </div>
            <div className="flex flex-col gap-2">
              <Eyebrow>SubTabs, sidebar (a column from lg)</Eyebrow>
              <SubTabs items={subTabItems} value={sideTab} onChange={setSideTab} variant="sidebar" idPrefix="ds-side" ariaLabel="Sidebar demo">
                <SubTabPanel tab={sideTab}>
                  <p className="text-sm text-neutral-500">Panel: {sideTab}</p>
                </SubTabPanel>
              </SubTabs>
            </div>
          </Panel>
        </Section>

        <Section id="layout" title="Page grammar" intro="DashPage > DashPageHeader > stat tiles > Toolbar > list. Lists are Panel divided with a tableHead recipe row; grids use recipes.cardGrid.">
          <div className={recipes.statGrid}>
            <StatCard icon={<BookOpen size={18} />} iconClass="bg-sky-50 text-sky-600" label="Courses" value={24} />
            <StatCard icon={<CheckCircle size={18} />} iconClass="bg-emerald-50 text-emerald-600" label="Published" value={18} active onClick={() => {}} />
            <StatCard icon={<PencilSimple size={18} />} iconClass="bg-amber-50 text-amber-600" label="Drafts" value={6} onClick={() => {}} />
            <StatCard icon={<Users size={18} />} iconClass="bg-violet-50 text-violet-600" label="Learners" value={null} />
          </div>
          <Panel divided>
            <div className={`${recipes.tableHead} hidden sm:grid grid-cols-[1fr_120px_120px] gap-4`}>
              <span>Course</span>
              <span>Status</span>
              <span>Updated</span>
            </div>
            {[
              { name: 'Networking fundamentals', status: 'success' as Status, label: 'Published', when: '3 min ago' },
              { name: 'DNS in depth', status: 'warning' as Status, label: 'Draft', when: 'yesterday' },
              { name: 'TLS for builders', status: 'info' as Status, label: 'Scheduled', when: 'Nov 2' },
            ].map((row) => (
              <div key={row.name} className="grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_120px_120px] items-center gap-x-4 gap-y-1 px-5 py-3.5 hover:bg-neutral-50/70 transition-colors">
                <div className="flex items-center gap-3 min-w-0">
                  <div className={recipes.iconTile}>
                    <BookOpen size={16} />
                  </div>
                  <span className="text-sm font-semibold text-neutral-900 truncate">{row.name}</span>
                </div>
                <span>
                  <StatusPill status={row.status} dot>
                    {row.label}
                  </StatusPill>
                </span>
                <span className="hidden sm:block text-xs text-neutral-400 tabular-nums">{row.when}</span>
              </div>
            ))}
          </Panel>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => setBulk((v) => !v)}>
              {bulk ? 'Hide' : 'Show'} BulkActionBar
            </Button>
            <span className="text-xs text-neutral-500">Docks to the bottom of the viewport while rows are selected.</span>
          </div>
          <BulkActionBar count={bulk ? 2 : 0} label="2 selected" onClear={() => setBulk(false)}>
            <BulkActionButton icon={<Copy size={14} />} label="Duplicate" />
            <BulkActionButton icon={<Trash size={14} />} label="Delete" danger />
          </BulkActionBar>
        </Section>

        <Section id="forms" title="Forms & settings" intro="SectionCard stacks settings; SettingRow puts the label at the start and the control at the end; StickySaveBar appears while edits are unsaved.">
          <div className="grid gap-4 lg:grid-cols-2">
            <SectionCard title="General" description="Name and summary shown to learners" icon={<Info size={18} />}>
              <div className="flex flex-col gap-4">
                <label className="block">
                  <FieldLabel hint="Up to 80 characters">Name</FieldLabel>
                  <input className={INPUT} defaultValue="Networking fundamentals" onChange={() => setDirty(true)} />
                </label>
                <label className="block">
                  <FieldLabel error="Add a short summary">Summary</FieldLabel>
                  <textarea className={TEXTAREA} rows={3} onChange={() => setDirty(true)} />
                </label>
              </div>
            </SectionCard>
            <SectionCard title="Access" icon={<Lock size={18} />} actions={<Chip tone="sky">Pro</Chip>}>
              <div className="divide-y divide-neutral-100">
                <SettingRow title="Show in catalog" description="Anyone visiting the org can find it" control={<Button size="sm" onClick={() => setDirty(true)}>Toggle</Button>} icon={<Eye size={16} />} />
                <SettingRow title="Certificates" description="Issue one on completion" control={<Chip tone="emerald">On</Chip>} />
              </div>
              <div role="radiogroup" className="grid gap-2 sm:grid-cols-2 mt-4">
                <ChoiceCard selected={choice === 'public'} onClick={() => setChoice('public')} icon={<Eye size={18} />} title="Public" description="Listed and open" />
                <ChoiceCard selected={choice === 'private'} onClick={() => setChoice('private')} icon={<Lock size={18} />} title="Private" description="Invite only" />
              </div>
            </SectionCard>
          </div>
          <div className="flex flex-col gap-2 max-w-lg">
            <OptionCard icon={<Plus size={20} />} iconClass="bg-sky-50 text-sky-600" title="Start from scratch" description="An empty course with one chapter" onClick={() => {}} />
            <OptionCard icon={<Lock size={20} />} iconClass="bg-amber-50 text-amber-600" title="Import a package" description="SCORM or IMS" badge={<Chip tone="amber">Pro</Chip>} onClick={() => {}} disabled />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => setDirty((v) => !v)}>
              Toggle StickySaveBar
            </Button>
            <Button size="sm" variant="danger-ghost" icon={<Trash size={12} />} onClick={() => setConfirmOpen(true)}>
              Open ConfirmDialog
            </Button>
          </div>
          <StickySaveBar visible={dirty} onSave={() => setDirty(false)} onDiscard={() => setDirty(false)} />
          <ConfirmDialog
            open={confirmOpen}
            onOpenChange={setConfirmOpen}
            title="Delete this course?"
            message="Learners lose access right away. This cannot be undone."
            confirmLabel="Delete"
            onConfirm={() => undefined}
          />
        </Section>

        <Section id="states" title="Empty, loading, error" intro="Empty: EmptyState in a Panel, with the next action. Loading: Skeleton shaped like the content. Error: the same EmptyState with WarningCircle and a retry.">
          <div className="grid gap-4 lg:grid-cols-3">
            <Panel>
              <EmptyState icon={<BookOpen size={22} />} title="No courses yet" description="Create your first course to see it here." action={<Button variant="primary" icon={<Plus size={14} weight="bold" />}>New course</Button>} />
            </Panel>
            <Panel padded className="flex flex-col gap-3" aria-busy="true">
              <div className="flex items-center gap-3">
                <Skeleton className="w-9 h-9 rounded-xl" />
                <div className="flex-1 flex flex-col gap-2">
                  <Skeleton className="h-3.5 w-2/3" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
              </div>
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-3 w-1/2" />
            </Panel>
            <Panel>
              <EmptyState icon={<WarningCircle size={22} />} title="Could not load courses" description="Check your connection and try again." action={<Button size="sm">Retry</Button>} />
            </Panel>
          </div>
        </Section>

        <Section id="ai" title="AI branding" intro="Every AI feature wears the LearnHouse AI mark and the violet family; nothing else uses violet or gradients.">
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel padded className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-3">
                <AIMark size={20} />
                <AIMark size={32} />
                <AIMark size={48} />
                <AIAvatar size={28} />
                <AIChip />
                <AIChip tone="soft" />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <AIButton variant="solid">Ask AI</AIButton>
                <AIButton variant="soft">Suggest</AIButton>
                <AIButton variant="outline">Generate</AIButton>
                <AIButton variant="solid" size="sm" loading>
                  Writing
                </AIButton>
              </div>
              <AIThinking />
              <AIShimmer lines={3} />
            </Panel>
            <div className={aiSurface.panel}>
              <AISurfaceHeader title="Course assistant" description="Drafts outlines from your notes" actions={<Button size="icon" variant="ghost" aria-label="Settings"><Gear size={14} /></Button>} />
              <div className="p-4 flex flex-col gap-3">
                <div className={`${aiSurface.tint} p-3 text-sm text-violet-900`}>Tip: paste a syllabus and ask for a chapter plan.</div>
                <div className={`${aiSurface.prompt} p-3 text-sm text-neutral-400`}>Ask anything about this course</div>
              </div>
            </div>
          </div>
        </Section>

        <Section id="dark" title="Dark surfaces" intro="The app is light; dark is reserved for floating bars (neutral-900), focus mode's theater (#0b0b0c) and the midnight AI panels. On dark, text steps through white opacity instead of greys.">
          <div className="grid gap-4 lg:grid-cols-3">
            <div className={`${recipes.readingDark} rounded-2xl p-5 flex flex-col gap-3`}>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-white/45">Focus mode, dark</p>
              <p className="text-lg font-semibold">Lesson 3 · Records</p>
              <div className="flex flex-col gap-1 text-sm">
                <span className="text-white/90">white/90 primary</span>
                <span className="text-white/70">white/70 secondary</span>
                <span className="text-white/50">white/50 muted</span>
                <span className="text-white/30">white/30 subtle</span>
              </div>
              <button type="button" className={`${recipes.darkControl} h-8 px-3 rounded-lg text-xs font-semibold w-fit transition-colors focus-visible:outline-none focus-visible:ring-2`}>
                Exit focus
              </button>
            </div>
            <div className="rounded-2xl bg-neutral-50 p-5 flex flex-col justify-end gap-3">
              <Eyebrow>Floating bar</Eyebrow>
              <div className={`${recipes.floatingBar} flex flex-wrap items-center gap-1.5 ps-4 pe-2 py-2 w-fit max-w-full`}>
                <span className="flex items-center gap-2 text-sm font-medium pe-2">
                  <span className={recipes.dirtyDot} />
                  Unsaved changes
                </span>
                <button type="button" className={recipes.floatingBarButton}>
                  Discard
                </button>
                <button type="button" className="h-8 px-4 rounded-lg bg-white text-neutral-900 text-xs font-semibold hover:bg-neutral-100 transition-colors">
                  Save
                </button>
              </div>
            </div>
            <div className="rounded-2xl p-5 flex flex-col gap-3 text-white overflow-hidden" style={{ background: AI_DARK_SURFACE }}>
              <div className="flex items-center gap-2">
                <AIMark size={24} />
                <span className="text-sm font-semibold">Magic Blocks</span>
              </div>
              <AIThinking tone="dark" />
              <AIShimmer tone="dark" lines={2} />
            </div>
          </div>
          <Panel padded className="flex flex-wrap items-center gap-3">
            <House size={16} className="text-neutral-400" />
            <span className="text-sm text-neutral-600">
              Learner side uses the same Panel and Button language; org themes restyle it through lh-t-* markers only.
            </span>
            <ChartBar size={16} className="text-neutral-400 rtl:-scale-x-100" />
          </Panel>
        </Section>
      </DashPage>
    </div>
  )
}
