'use client'
/*
 Visual map of a scenario: steps as cards in columns (distance from the
 start), choices as arrows. Read-only layout; clicking a card selects that
 step so the side panel can edit it.

 The dotted canvas is sized max(content, container) on both axes, so it
 always fills the frame it sits in (inline, expanded, phone) instead of
 stopping at the content's height.
*/
import React from 'react'
import { useTranslation } from 'react-i18next'
import { Flag, FlagCheckered, Warning } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import { MAP, MapLayout, ScenarioData, ScenarioReport, choiceLetter, excerpt, isEnding, layoutScenario, startIdOf, stepById } from './scenarioModel'

const DOTS: React.CSSProperties = {
  backgroundColor: '#fafafa',
  backgroundImage: 'radial-gradient(circle, rgb(212 212 212) 1px, transparent 1.3px)',
  backgroundSize: '18px 18px',
}

function anchorY(y: number, i: number, n: number) {
  return y + (MAP.cardH * (i + 1)) / (n + 1)
}

function edgePath(x1: number, y1: number, x2: number, y2: number, belowY: number) {
  if (x2 > x1 + 12) {
    const dx = Math.max(28, (x2 - x1) / 2)
    return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`
  }
  // Back edge (or a step that repeats itself): around underneath.
  const r = 10
  const out = x1 + 22
  const back = x2 - 22
  return [
    `M ${x1} ${y1}`,
    `H ${out - r}`,
    `Q ${out} ${y1} ${out} ${y1 + r}`,
    `V ${belowY - r}`,
    `Q ${out} ${belowY} ${out - r} ${belowY}`,
    `H ${back + r}`,
    `Q ${back} ${belowY} ${back} ${belowY - r}`,
    `V ${y2 + r}`,
    `Q ${back} ${y2} ${back + r} ${y2}`,
    `H ${x2}`,
  ].join(' ')
}

export function ScenarioMap({
  data,
  report,
  selectedId,
  onSelect,
  className,
}: {
  data: ScenarioData
  report: ScenarioReport
  selectedId: string | null
  onSelect: (_id: string | null) => void
  className?: string
}) {
  const { t } = useTranslation()
  const layout: MapLayout = React.useMemo(() => layoutScenario(data), [data])
  const start = startIdOf(data)
  const pos = React.useMemo(() => new Map(layout.nodes.map((n) => [n.id, n])), [layout])

  return (
    <div className={cn('relative h-full w-full overflow-auto overscroll-contain', className)} data-testid="scenario-map">
      <div
        dir="ltr"
        className="relative"
        style={{ ...DOTS, width: layout.width, height: layout.height, minWidth: '100%', minHeight: '100%' }}
        onClick={(e) => {
          if (e.target === e.currentTarget) onSelect(null)
        }}
        data-testid="scenario-map-canvas"
      >
        <svg width={layout.width} height={layout.height} className="pointer-events-none absolute start-0 top-0" aria-hidden>
          <defs>
            {(['idle', 'hot', 'broken'] as const).map((k) => (
              <marker key={k} id={`scn-arrow-${k}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M 0 1 L 9 5 L 0 9 z" fill={k === 'hot' ? '#16a34a' : k === 'broken' ? '#fb7185' : '#c4c4c4'} />
              </marker>
            ))}
          </defs>
          {layout.edges.map((edge) => {
            const from = pos.get(edge.from)
            const step = stepById(data, edge.from)
            if (!from || !step) return null
            const x1 = from.x + MAP.cardW + 7
            const y1 = anchorY(from.y, edge.index, step.options.length)
            let d: string
            let kind: 'idle' | 'hot' | 'broken' = selectedId && (edge.from === selectedId || edge.to === selectedId) ? 'hot' : 'idle'
            if (edge.to === 'broken') {
              d = `M ${x1} ${y1} H ${x1 + 34}`
              kind = 'broken'
            } else if (edge.to === 'end' && layout.end) {
              d = edgePath(x1, y1, layout.end.x - 2, layout.end.y + 16, 0)
            } else {
              const to = pos.get(edge.to)
              if (!to) return null
              const below = Math.max(from.y, to.y) + MAP.cardH + MAP.gapY / 2
              d = edgePath(x1, y1, to.x - 2, to.y + MAP.cardH / 2, below)
            }
            return (
              <g key={`${edge.from}-${edge.choiceId}`}>
                <path
                  d={d}
                  fill="none"
                  stroke={kind === 'hot' ? '#16a34a' : kind === 'broken' ? '#fb7185' : '#cfcfcf'}
                  strokeWidth={kind === 'hot' ? 1.75 : 1.25}
                  strokeDasharray={kind === 'broken' ? '4 3' : undefined}
                  markerEnd={`url(#scn-arrow-${kind})`}
                />
                <circle cx={x1} cy={y1} r={7} fill="white" stroke={kind === 'hot' ? '#16a34a' : '#d4d4d4'} strokeWidth={1} />
                <text x={x1} y={y1 + 3} textAnchor="middle" fontSize="8.5" fontWeight={700} fill={kind === 'hot' ? '#15803d' : '#737373'}>
                  {choiceLetter(edge.index)}
                </text>
              </g>
            )
          })}
        </svg>

        {layout.nodes.map((node) => {
          const step = stepById(data, node.id)!
          const issues = report.byStep[node.id] ?? []
          const error = issues.some((i) => i.level === 'error')
          const warn = !error && issues.length > 0
          const selected = node.id === selectedId
          const isStart = node.id === start
          return (
            <button
              key={node.id}
              type="button"
              onClick={() => onSelect(selected ? null : node.id)}
              aria-pressed={selected}
              data-step-card={node.id}
              className={cn(
                'absolute flex flex-col rounded-xl bg-white p-2.5 text-start transition-[box-shadow,transform] duration-150 focus-visible:outline-none',
                selected
                  ? 'shadow-[0_4px_14px_rgba(22,163,74,0.14),0_0_0_2px_rgba(22,163,74,0.7)]'
                  : 'shadow-[0_1px_2px_rgba(0,0,0,0.05),0_0_0_1px_rgba(0,0,0,0.08)] hover:shadow-[0_2px_8px_rgba(0,0,0,0.06),0_0_0_1px_rgba(0,0,0,0.14)] focus-visible:shadow-[0_0_0_2px_rgba(22,163,74,0.5)]',
                !node.reachable && 'opacity-70',
              )}
              style={{ left: node.x, top: node.y, width: MAP.cardW, height: MAP.cardH }}
            >
              <span className="flex items-center gap-1.5">
                <span
                  className={cn(
                    'flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] font-semibold',
                    isStart ? 'bg-emerald-500 text-white' : 'bg-neutral-100 text-neutral-500',
                  )}
                >
                  {data.scenarios.findIndex((s) => s.id === node.id) + 1}
                </span>
                {isStart && (
                  <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-emerald-700">
                    <Flag size={10} weight="fill" />
                    {t('editor.blocks_v2.scenarios.start', 'Start')}
                  </span>
                )}
                {isEnding(step) && (
                  <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-emerald-700">
                    <FlagCheckered size={10} weight="duotone" />
                    {t('editor.blocks_v2.scenarios.ending', 'Ending')}
                  </span>
                )}
                {!node.reachable && (
                  <span className="text-[10px] font-medium text-amber-700">{t('editor.blocks_v2.scenarios.unlinked', 'Unlinked')}</span>
                )}
                {(error || warn) && (
                  <Warning size={13} weight="fill" className={cn('ms-auto', error ? 'text-rose-500' : 'text-amber-500')} />
                )}
              </span>
              <span dir="auto" className="mt-1 line-clamp-2 text-[12px] leading-snug text-neutral-700">
                {excerpt(step.text, 90) || <em className="text-neutral-400">{t('editor.blocks_v2.scenarios.untitled_step', 'Empty step')}</em>}
              </span>
              <span className="mt-auto text-[10px] text-neutral-400">
                {t('editor.blocks_v2.scenarios.choice_count', { count: step.options.length, defaultValue: '{{count}} choices' })}
              </span>
            </button>
          )
        })}

        {layout.end && (
          <div
            className="absolute flex h-8 items-center justify-center gap-1 rounded-full bg-emerald-50 text-[11px] font-semibold text-emerald-700 shadow-[0_0_0_1px_rgba(5,150,105,0.2)]"
            style={{ left: layout.end.x, top: layout.end.y, width: MAP.endW }}
          >
            <FlagCheckered size={12} weight="duotone" />
            {t('editor.blocks_v2.scenarios.end', 'End')}
          </div>
        )}
      </div>
    </div>
  )
}

export default ScenarioMap
