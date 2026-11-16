// Default renderers for view components. Each reads the validated props the
// server sends (see GET /api/v1/agent/views/schema) defensively, and renders
// text through React only. Override any of them with <AgentChat renderers>.
import React, { useState } from 'react'
import type { ReactNode } from 'react'
import type {
  CalloutComponent,
  CardsComponent,
  Cell,
  ChartComponent,
  ChecklistComponent,
  CodeComponent,
  ColumnFormat,
  ComparisonComponent,
  KpisComponent,
  ProgressComponent,
  QuizComponent,
  StepsComponent,
  TableComponent,
  TextComponent,
  TimelineComponent,
  ViewComponent,
  ViewLink,
} from '@learnhouse/sdk'
import { Markdown } from './markdown'
import type { ViewComponentRendererProps, ViewRenderers } from './types'

type P<C extends ViewComponent> = ViewComponentRendererProps<C>

const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])
const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '')
const numv = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

export function formatCell(value: Cell | undefined, format?: ColumnFormat, unit?: string | null): string {
  if (value === null || value === undefined || value === '') return '–'
  if (typeof value === 'object') return '–'
  if (typeof value === 'boolean') return value ? '✓' : '–'
  if (typeof value === 'number') {
    const nf = (o: Intl.NumberFormatOptions) => new Intl.NumberFormat(undefined, o).format(value)
    if (format === 'percent') return `${nf({ maximumFractionDigits: 1 })}%`
    if (format === 'duration') {
      const m = Math.round(value / 60)
      return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`
    }
    if (format === 'currency' && unit && /^[A-Z]{3}$/.test(unit)) {
      try {
        return new Intl.NumberFormat(undefined, { style: 'currency', currency: unit }).format(value)
      } catch {
        // unknown currency code: plain number
      }
    }
    return `${nf({ maximumFractionDigits: 2 })}${unit && format !== 'currency' ? ` ${unit}` : ''}`
  }
  if (format === 'date') {
    const d = new Date(value)
    if (!Number.isNaN(d.getTime())) return d.toLocaleDateString()
  }
  return String(value)
}

export function Heading({ children }: { children?: ReactNode }) {
  if (!children) return null
  return <div className="lh-agent-c-title">{children}</div>
}

function Linked({ href, children }: { href?: string; children: ReactNode }) {
  return href ? (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ) : (
    <>{children}</>
  )
}

export function KpisView({ component }: P<KpisComponent>) {
  const c = component
  return (
    <div className="lh-agent-c lh-agent-kpis">
      <Heading>{c.title}</Heading>
      <div className="lh-agent-kpis-grid">
        {arr<KpisComponent['items'][number]>(c.items).map((item, i) => (
          <div key={i} className="lh-agent-kpi" data-tone={item.tone}>
            <div className="lh-agent-kpi-label">{str(item.label)}</div>
            <div className="lh-agent-kpi-value">
              {typeof item.value === 'number' ? formatCell(item.value) : str(item.value)}
              {item.unit ? <span className="lh-agent-kpi-unit"> {item.unit}</span> : null}
            </div>
            {typeof item.delta === 'number' ? (
              <div className="lh-agent-kpi-delta" data-trend={item.delta > 0 ? 'up' : item.delta < 0 ? 'down' : 'flat'}>
                {item.delta > 0 ? '▲' : item.delta < 0 ? '▼' : '•'} {Math.abs(item.delta)}
              </div>
            ) : null}
            {item.hint ? <div className="lh-agent-kpi-hint">{item.hint}</div> : null}
          </div>
        ))}
      </div>
    </div>
  )
}

type LooseRow = Record<string, unknown> & { _link?: ViewLink | null; cells?: Record<string, Cell>; link?: ViewLink | null }

/** Rows are flat `{ <column key>: value, _link? }` objects (the wire shape); arrays and `{ cells, link }` are read too. */
export function TableView({ component, resolveLink }: P<TableComponent>) {
  const c = component
  const columns = arr<TableComponent['columns'][number] | string>(c.columns).map((col) =>
    typeof col === 'string' ? { key: col, label: col, format: 'text' as ColumnFormat, unit: undefined } : col,
  )
  const numeric = (f?: ColumnFormat) => f === 'number' || f === 'percent' || f === 'duration' || f === 'currency'
  return (
    <div className="lh-agent-c">
      <Heading>{c.title}</Heading>
      <div className="lh-agent-table-wrap">
        <table className="lh-agent-table">
          {c.caption ? <caption>{c.caption}</caption> : null}
          <thead>
            <tr>
              {columns.map((col) => (
                <th key={col.key} data-numeric={numeric(col.format) || undefined}>
                  {col.label ?? col.key}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {arr<LooseRow | Cell[]>(c.rows).map((row, ri) => {
              const cells: Record<string, unknown> = Array.isArray(row)
                ? Object.fromEntries(columns.map((col, j) => [col.key, row[j] ?? null]))
                : row.cells && typeof row.cells === 'object' && !(columns.some((col) => col.key in row))
                  ? row.cells
                  : row
              const href = Array.isArray(row) ? undefined : resolveLink(row._link ?? row.link ?? undefined)
              return (
                <tr key={ri}>
                  {columns.map((col, j) => (
                    <td key={col.key} data-numeric={numeric(col.format) || undefined}>
                      {j === 0 ? (
                        <Linked href={href}>{formatCell(cells[col.key] as Cell, col.format, col.unit)}</Linked>
                      ) : (
                        formatCell(cells[col.key] as Cell, col.format, col.unit)
                      )}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const PALETTE = ['var(--lh-agent-accent)', '#0ea5e9', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6']

/** Bar (grouped or stacked), line and area charts in plain SVG; pie/donut/funnel draw as bars. */
export function ChartView({ component }: P<ChartComponent>) {
  const c = component
  const data = arr<Record<string, Cell>>(c.data)
  const series = arr<ChartComponent['series'][number]>(c.series).filter((s) => s && s.key)
  const labels = data.map((row) => str(row[c.x_key]))
  const W = 560
  const H = 220
  const pad = { l: 40, r: 12, t: 12, b: 28 }
  const iw = W - pad.l - pad.r
  const ih = H - pad.t - pad.b
  const value = (row: Record<string, Cell>, key: string) => numv(row[key])
  const stacked = !!c.stacked && c.kind === 'bar'
  const max = Math.max(
    1,
    ...data.map((row) => (stacked ? series.reduce((n, s) => n + Math.max(0, value(row, s.key)), 0) : Math.max(0, ...series.map((s) => value(row, s.key))))),
  )
  const y = (v: number) => pad.t + ih - (Math.max(0, v) / max) * ih
  const line = c.kind === 'line' || c.kind === 'area'
  const step = data.length ? iw / data.length : iw
  const x = (i: number) => pad.l + step * i + step / 2
  const ticks = [0, 0.5, 1].map((t) => t * max)
  return (
    <div className="lh-agent-c lh-agent-chart">
      <Heading>{c.title}</Heading>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={c.title ?? 'Chart'} className="lh-agent-chart-svg">
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="lh-agent-chart-grid" />
            <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" className="lh-agent-chart-tick">
              {formatCell(Math.round(t * 100) / 100)}
            </text>
          </g>
        ))}
        {line
          ? series.map((s, si) => {
              const pts = data.map((row, i) => `${x(i)},${y(value(row, s.key))}`)
              const color = PALETTE[si % PALETTE.length]
              return (
                <g key={s.key}>
                  {c.kind === 'area' && pts.length ? (
                    <polygon points={`${x(0)},${y(0)} ${pts.join(' ')} ${x(data.length - 1)},${y(0)}`} fill={color} opacity={0.15} />
                  ) : null}
                  <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth={2} />
                  {data.map((row, i) => (
                    <circle key={i} cx={x(i)} cy={y(value(row, s.key))} r={3} fill={color}>
                      <title>{`${labels[i]}: ${formatCell(row[s.key], 'number', c.unit)}`}</title>
                    </circle>
                  ))}
                </g>
              )
            })
          : data.map((row, i) => {
              const groupW = step * 0.7
              const barW = stacked ? groupW : groupW / Math.max(1, series.length)
              let acc = 0
              return (
                <g key={i}>
                  {series.map((s, si) => {
                    const v = Math.max(0, value(row, s.key))
                    const top = stacked ? y(acc + v) : y(v)
                    const bottom = stacked ? y(acc) : y(0)
                    const left = pad.l + step * i + (step - groupW) / 2 + (stacked ? 0 : barW * si)
                    acc += v
                    return (
                      <rect key={s.key} x={left} y={top} width={Math.max(1, barW - 2)} height={Math.max(0, bottom - top)} rx={2} fill={PALETTE[si % PALETTE.length]}>
                        <title>{`${labels[i]} · ${s.label ?? s.key}: ${formatCell(row[s.key], 'number', c.unit)}`}</title>
                      </rect>
                    )
                  })}
                </g>
              )
            })}
        {labels.map((label, i) =>
          data.length <= 12 || i % Math.ceil(data.length / 12) === 0 ? (
            <text key={i} x={x(i)} y={H - 8} textAnchor="middle" className="lh-agent-chart-tick">
              {label.length > 10 ? `${label.slice(0, 9)}…` : label}
            </text>
          ) : null,
        )}
      </svg>
      {series.length > 1 ? (
        <div className="lh-agent-legend">
          {series.map((s, si) => (
            <span key={s.key}>
              <i style={{ background: PALETTE[si % PALETTE.length] }} /> {s.label ?? s.key}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function CardsView({ component, resolveLink }: P<CardsComponent>) {
  const c = component
  return (
    <div className="lh-agent-c">
      <Heading>{c.title}</Heading>
      <div className="lh-agent-cards">
        {arr<CardsComponent['items'][number]>(c.items).map((item, i) => (
          <div key={i} className="lh-agent-card">
            <div className="lh-agent-card-kind">{str(item.kind)}</div>
            <div className="lh-agent-card-name">
              <Linked href={item.uuid ? resolveLink({ kind: item.kind, uuid: item.uuid }) : undefined}>{str(item.name)}</Linked>
            </div>
            {item.subtitle ? <div className="lh-agent-card-sub">{item.subtitle}</div> : null}
            {arr<string>(item.badges).length ? (
              <div className="lh-agent-badges">
                {arr<string>(item.badges).map((b, j) => (
                  <span key={j} className="lh-agent-badge">
                    {b}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  )
}

export function TimelineView({ component }: P<TimelineComponent>) {
  const c = component
  return (
    <div className="lh-agent-c">
      <Heading>{c.title}</Heading>
      <ol className="lh-agent-timeline">
        {arr<TimelineComponent['items'][number]>(c.items).map((item, i) => (
          <li key={i} data-tone={item.tone}>
            <span className="lh-agent-timeline-time">{str(item.time)}</span>
            <span className="lh-agent-timeline-title">{str(item.title)}</span>
            {item.detail ? <span className="lh-agent-muted">{item.detail}</span> : null}
          </li>
        ))}
      </ol>
    </div>
  )
}

const STEP_ICON: Record<string, string> = { done: '✓', current: '●', upcoming: '○', failed: '✕', skipped: '–' }

export function StepsView({ component }: P<StepsComponent>) {
  const c = component
  return (
    <div className="lh-agent-c">
      <Heading>{c.title}</Heading>
      <ol className="lh-agent-steps">
        {arr<StepsComponent['items'][number]>(c.items).map((item, i) => (
          <li key={i} data-status={item.status ?? 'upcoming'}>
            <span className="lh-agent-step-icon" aria-hidden="true">
              {STEP_ICON[item.status ?? 'upcoming'] ?? i + 1}
            </span>
            <span>
              <span className="lh-agent-step-title">{str(item.title)}</span>
              {item.detail ? <span className="lh-agent-muted"> {item.detail}</span> : null}
            </span>
          </li>
        ))}
      </ol>
    </div>
  )
}

export function CalloutView({ component }: P<CalloutComponent>) {
  const c = component
  return (
    <div className="lh-agent-c lh-agent-callout" data-tone={c.tone ?? 'info'} role="note">
      {c.title ? <div className="lh-agent-callout-title">{c.title}</div> : null}
      <Markdown text={str(c.text ?? (c as ViewComponent).body)} />
    </div>
  )
}

export function TextView({ component }: P<TextComponent>) {
  return (
    <div className="lh-agent-c">
      <Markdown text={str(component.markdown ?? (component as ViewComponent).text)} />
    </div>
  )
}

export function ChecklistView({ component }: P<ChecklistComponent>) {
  const c = component
  return (
    <div className="lh-agent-c">
      <Heading>{c.title}</Heading>
      <ul className="lh-agent-checklist">
        {arr<ChecklistComponent['items'][number]>(c.items).map((item, i) => (
          <li key={i} data-checked={item.checked || undefined}>
            <span className="lh-agent-check" aria-hidden="true">
              {item.checked ? '✓' : ''}
            </span>
            <span>
              {str(item.label)}
              {item.detail ? <span className="lh-agent-muted"> {item.detail}</span> : null}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function ProgressView({ component, resolveLink }: P<ProgressComponent>) {
  const c = component
  return (
    <div className="lh-agent-c">
      <Heading>{c.title}</Heading>
      <div className="lh-agent-progress-list">
        {arr<ProgressComponent['items'][number]>(c.items).map((item, i) => {
          const max = numv(item.max) || 100
          const pct = Math.max(0, Math.min(100, (numv(item.value) / max) * 100))
          return (
            <div key={i} className="lh-agent-progress" data-tone={item.tone}>
              <div className="lh-agent-progress-head">
                <Linked href={resolveLink(item.link)}>{str(item.label)}</Linked>
                <span className="lh-agent-muted">
                  {formatCell(item.value)}
                  {item.max ? ` / ${formatCell(item.max)}` : ''}
                  {item.unit ? ` ${item.unit}` : ''}
                </span>
              </div>
              <div className="lh-agent-bar" role="progressbar" aria-valuemin={0} aria-valuemax={max} aria-valuenow={numv(item.value)}>
                <div style={{ width: `${pct}%` }} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function ComparisonView({ component }: P<ComparisonComponent>) {
  const c = component
  return (
    <div className="lh-agent-c">
      <Heading>{c.title}</Heading>
      <div className="lh-agent-comparison">
        {arr<ComparisonComponent['columns'][number]>(c.columns).map((col, i) => (
          <div key={i} className="lh-agent-comparison-col" data-highlight={col.highlight || undefined}>
            <div className="lh-agent-card-name">
              {str(col.title)} {col.badge ? <span className="lh-agent-badge">{col.badge}</span> : null}
            </div>
            {col.subtitle ? <div className="lh-agent-card-sub">{col.subtitle}</div> : null}
            <ul>
              {arr<string>(col.items).map((it, j) => (
                <li key={j}>{str(it)}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  )
}

export function CodeView({ component }: P<CodeComponent>) {
  const c = component
  const highlight = new Set(arr<number>(c.highlight))
  const lines = str(c.code).split('\n')
  return (
    <div className="lh-agent-c">
      <Heading>{c.title ?? c.filename}</Heading>
      <pre className="lh-agent-code" data-language={c.language || undefined}>
        <code>
          {lines.map((line, i) => (
            <span key={i} className="lh-agent-code-line" data-hl={highlight.has(i + 1) || undefined}>
              {line}
              {'\n'}
            </span>
          ))}
        </code>
      </pre>
      {c.output ? (
        <pre className="lh-agent-code lh-agent-code-output" data-tone={c.output_tone}>
          <code>{c.output}</code>
        </pre>
      ) : null}
    </div>
  )
}

/** Static quiz: options are shown, answers revealed on demand. */
export function QuizView({ component }: P<QuizComponent>) {
  const c = component
  const [shown, setShown] = useState(false)
  return (
    <div className="lh-agent-c lh-agent-quiz">
      <Heading>{c.title}</Heading>
      <ol>
        {arr<QuizComponent['questions'][number]>(c.questions).map((q, i) => (
          <li key={i}>
            <div className="lh-agent-quiz-q">{str(q.text)}</div>
            <ul>
              {arr<QuizComponent['questions'][number]['options'][number]>(q.options).map((o, j) => (
                <li key={j} data-correct={shown && o.correct ? true : undefined}>
                  {str(o.text)}
                  {shown && o.correct ? ' ✓' : ''}
                </li>
              ))}
            </ul>
            {shown && q.explanation ? <div className="lh-agent-muted">{q.explanation}</div> : null}
          </li>
        ))}
      </ol>
      <button type="button" className="lh-agent-btn" onClick={() => setShown((s) => !s)}>
        {shown ? 'Hide answers' : 'Show answers'}
      </button>
    </div>
  )
}

export function ChoicesView({ component, send }: P<ViewComponent>) {
  const options = arr<{ label: string; prompt: string }>(component.options)
  return (
    <div className="lh-agent-c">
      <Heading>{str(component.title)}</Heading>
      <div className="lh-agent-chips">
        {options.map((o, i) => (
          <button key={i} type="button" className="lh-agent-chip" disabled={!send} onClick={() => send?.(str(o.prompt) || str(o.label))}>
            {str(o.label)}
          </button>
        ))}
      </div>
    </div>
  )
}

export function GlossaryView({ component }: P<ViewComponent>) {
  const terms = arr<{ term: string; definition: string; example?: string }>(component.terms)
  return (
    <div className="lh-agent-c">
      <Heading>{str(component.title)}</Heading>
      <dl className="lh-agent-glossary">
        {terms.map((t, i) => (
          <React.Fragment key={i}>
            <dt>{str(t.term)}</dt>
            <dd>
              {str(t.definition)}
              {t.example ? <div className="lh-agent-muted">{t.example}</div> : null}
            </dd>
          </React.Fragment>
        ))}
      </dl>
    </div>
  )
}

/** Built-in renderers, keyed by component type. Unknown types fall back to the view's markdown. */
export const defaultViewRenderers: ViewRenderers = {
  kpis: KpisView,
  table: TableView,
  chart: ChartView,
  cards: CardsView,
  timeline: TimelineView,
  steps: StepsView,
  callout: CalloutView,
  text: TextView,
  checklist: ChecklistView,
  progress: ProgressView,
  comparison: ComparisonView,
  code: CodeView,
  quiz: QuizView,
  choices: ChoicesView,
  glossary: GlossaryView,
}
