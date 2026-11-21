'use client'
/*
 Chart: a hand-drawn, responsive SVG (bar, column, line, area, pie, donut)
 laid out for the real width of its column. Hover or focus a bar, point or
 slice for a tooltip; screen readers get the SVG title/description, a label
 per mark and a hidden data table. Colours come from the design system
 chart palette (CSS variables), grid and axis from the lesson theme.
*/
import React from 'react'
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { ChartBar, ChartBarHorizontal, ChartDonut, ChartLine, ChartLineUp, ChartPie, SlidersHorizontal, Table } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import EditorBlockFrame from '../../../../Blocks/ui/EditorBlockFrame'
import { BlockPopover, BlockToolbarButton, BlockToolbarDivider, SettingsField } from '../../../../Blocks/ui/BlockChrome'
import { cn } from '@/lib/utils'
import {
  chartHeightFor,
  chartSummary,
  chartSvg,
  chartTable,
  chartTypeOf,
  CHART_DEFAULT_WIDTH,
  formatPercent,
  formatValue,
  isEmptyChart,
  layoutChart,
  normalizeChartData,
  seriesColor,
  type ChartData,
  type ChartType,
} from '../chartModel'
import { chartText } from '../labels'
import ChartDataEditor from './ChartDataEditor'
import { specToReact } from './svgSpec'
import { commitAttrs, InlineInput, SwitchRow, useElementWidth, useIsEditable } from './shared'

const TYPE_ICONS: Record<ChartType, React.ElementType> = {
  column: ChartBar,
  bar: ChartBarHorizontal,
  line: ChartLine,
  area: ChartLineUp,
  pie: ChartPie,
  donut: ChartDonut,
}
const TYPE_ORDER: ChartType[] = ['column', 'bar', 'line', 'area', 'pie', 'donut']

export default function ChartView(props: NodeViewProps) {
  const { t, i18n } = useTranslation()
  const isEditable = useIsEditable()
  const { node } = props
  const data = React.useMemo(() => normalizeChartData(node.attrs.data), [node.attrs.data])
  const type = chartTypeOf(node.attrs.type)
  const title = String(node.attrs.title || '')
  const stacked = !!node.attrs.stacked
  const showValues = !!node.attrs.showValues
  const showLegend = node.attrs.showLegend !== false
  const pie = type === 'pie' || type === 'donut'
  const text = React.useMemo(() => chartText(t as any), [t])
  const locale = i18n.language

  const [boxRef, width] = useElementWidth<HTMLDivElement>(CHART_DEFAULT_WIDTH)
  const height = chartHeightFor(width)
  const geometry = React.useMemo(() => layoutChart(data, { type, stacked, showValues, width, height }), [data, type, stacked, showValues, width, height])
  const [active, setActive] = React.useState<string | null>(null)
  const [typeOpen, setTypeOpen] = React.useState(false)
  const [settingsOpen, setSettingsOpen] = React.useState(false)
  const [dataOpen, setDataOpen] = React.useState(false)
  const empty = isEmptyChart(data)

  const svg = React.useMemo(
    () =>
      empty
        ? null
        : chartSvg(geometry, {
            title: title || text.fallbackTitle,
            desc: chartSummary(data, type, text, locale),
            data,
            showValues,
            text,
            locale,
            active,
          }),
    [empty, geometry, title, text, data, type, locale, showValues, active],
  )

  const markFrom = (target: EventTarget | null): string | null => {
    const el = (target as Element | null)?.closest?.('[data-mark]')
    return el ? el.getAttribute('data-mark') : null
  }

  // Tooltip content and anchor for the active mark.
  let tooltip: { x: number; y: number; title: string; rows: { color: string; name: string; value: string }[] } | null = null
  if (active && !empty) {
    const [si, ix] = active.split('-').map(Number)
    if (geometry.kind === 'pie') {
      const s = geometry.slices[ix]
      if (s) tooltip = { x: s.cx, y: s.cy, title: data.labels[ix] ?? '', rows: [{ color: s.color, name: data.series[0]?.name ?? '', value: `${formatValue(s.value, locale)} · ${formatPercent(s.share, locale)}` }] }
    } else {
      const m = geometry.marks.find((mk) => mk.series === si && mk.index === ix)
      if (m) tooltip = { x: m.cx, y: m.shape === 'rect' && geometry.valueAxis === 'x' ? m.cy - m.h / 2 : m.cy, title: data.labels[ix] ?? '', rows: [{ color: m.color, name: data.series[si]?.name ?? '', value: formatValue(m.value, locale) }] }
    }
  }

  const legend = !empty && showLegend ? (pie ? data.labels.map((name, i) => ({ name, color: seriesColor(undefined, i) })) : data.series.map((s, i) => ({ name: s.name, color: seriesColor(s, i) }))) : []

  const commitData = (next: ChartData) => commitAttrs(props, { data: next })

  const tools = (
    <>
      <BlockPopover
        open={typeOpen}
        onOpenChange={setTypeOpen}
        title={t('editor.blocks_v2.chart.type', 'Chart type')}
        width={264}
        trigger={
          <BlockToolbarButton label={t('editor.blocks_v2.chart.type', 'Chart type')} active={typeOpen}>
            {React.createElement(TYPE_ICONS[type], { size: 14 })}
          </BlockToolbarButton>
        }
      >
        <div role="radiogroup" aria-label={t('editor.blocks_v2.chart.type', 'Chart type')} className="grid grid-cols-3 gap-1.5">
          {TYPE_ORDER.map((ty) => {
            const Icon = TYPE_ICONS[ty]
            const on = ty === type
            return (
              <button
                key={ty}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => commitAttrs(props, { type: ty })}
                className={cn('flex flex-col items-center gap-1 rounded-lg px-1 py-2 text-[11px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-sky-500/40', on ? 'bg-neutral-900 text-white' : 'bg-neutral-50 text-neutral-600 hover:bg-neutral-100')}
              >
                <Icon size={18} weight={on ? 'fill' : 'regular'} />
                {text.typeName(ty)}
              </button>
            )
          })}
        </div>
      </BlockPopover>
      <BlockToolbarButton label={t('editor.blocks_v2.chart.edit_data', 'Edit data')} active={dataOpen} onClick={() => setDataOpen((o) => !o)}>
        <Table size={14} />
      </BlockToolbarButton>
      <BlockToolbarDivider />
      <BlockPopover
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        title={t('editor.blocks_v2.chart.label', 'Chart')}
        trigger={
          <BlockToolbarButton label={t('editor.blocks_v2.chart.settings', 'Chart settings')} active={settingsOpen}>
            <SlidersHorizontal size={14} />
          </BlockToolbarButton>
        }
      >
        <SettingsField label={t('editor.blocks_v2.chart.title_label', 'Title')}>
          <InlineInput value={title} maxLength={160} onCommit={(v) => commitAttrs(props, { title: v.trim() })} placeholder={t('editor.blocks_v2.chart.title_placeholder', 'Chart title')} aria-label={t('editor.blocks_v2.chart.title_label', 'Title')} className="h-8 w-full rounded-lg bg-white px-2.5 text-[13px] text-neutral-800 shadow-[0_0_0_1px_rgba(0,0,0,0.1)] outline-none" />
        </SettingsField>
        <SwitchRow label={t('editor.blocks_v2.chart.stacked', 'Stack series')} checked={stacked} disabled={pie || data.series.length < 2} onChange={(v) => commitAttrs(props, { stacked: v })} />
        <SwitchRow label={t('editor.blocks_v2.chart.show_legend', 'Show legend')} checked={showLegend} onChange={(v) => commitAttrs(props, { showLegend: v })} />
        <SwitchRow label={t('editor.blocks_v2.chart.show_values', 'Show values')} checked={showValues} onChange={(v) => commitAttrs(props, { showValues: v })} />
        {pie && data.series.length > 1 && <p className="m-0 text-[11px] text-neutral-400">{t('editor.blocks_v2.chart.pie_hint', 'Pie and donut charts show the first series.')}</p>}
      </BlockPopover>
    </>
  )

  if (empty && !isEditable) return title ? <NodeViewWrapper className="lh-chart my-5"><p className="m-0 text-[15px] font-semibold text-neutral-900">{title}</p></NodeViewWrapper> : null

  return (
    <NodeViewWrapper className="lh-chart my-5" data-chart-type={type}>
      <EditorBlockFrame
        editable={isEditable}
        node={node}
        editor={props.editor}
        getPos={props.getPos}
        selected={props.selected}
        tone="info"
        label={
          <>
            <ChartBar size={11} weight="bold" />
            {t('editor.blocks_v2.chart.label', 'Chart')}
          </>
        }
        tools={tools}
        forceToolbar={typeOpen || settingsOpen}
      >
        <figure className="m-0 rounded-2xl bg-white p-4 ring-1 ring-inset ring-neutral-200/80 sm:p-5">
          {(title || isEditable) &&
            (isEditable ? (
              <InlineInput value={title} maxLength={160} onCommit={(v) => commitAttrs(props, { title: v.trim() })} placeholder={t('editor.blocks_v2.chart.title_placeholder', 'Chart title')} aria-label={t('editor.blocks_v2.chart.title_label', 'Title')} className="mb-3 w-full min-w-0 bg-transparent text-[15px] font-semibold text-neutral-900 outline-none placeholder:text-neutral-400" />
            ) : (
              <figcaption className="mb-3 text-[15px] font-semibold text-neutral-900">{title}</figcaption>
            ))}
          <div
            ref={boxRef}
            dir="ltr"
            className="lh-chart-box relative w-full"
            contentEditable={false}
            onPointerOver={(e) => setActive(markFrom(e.target))}
            onPointerLeave={() => setActive(null)}
            onFocus={(e) => setActive(markFrom(e.target))}
            onBlur={() => setActive(null)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setActive(null)
            }}
          >
            {svg ? (
              specToReact(svg)
            ) : (
              <button type="button" onClick={() => setDataOpen(true)} className="flex w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-neutral-200 bg-neutral-50/60 py-10 text-sm text-neutral-500 hover:bg-neutral-50">
                <Table size={20} />
                {t('editor.blocks_v2.chart.empty', 'Add some data to draw the chart.')}
              </button>
            )}
            {tooltip && (
              <div
                role="presentation"
                className="lh-chart-tooltip pointer-events-none absolute z-10 min-w-[120px] -translate-x-1/2 -translate-y-full rounded-lg bg-neutral-900 px-2.5 py-1.5 text-[12px] text-white shadow-lg"
                style={{ left: Math.min(Math.max(tooltip.x, 60), width - 60), top: tooltip.y - 10 }}
              >
                <div className="font-semibold">{tooltip.title}</div>
                {tooltip.rows.map((r, i) => (
                  <div key={i} className="mt-0.5 flex items-center gap-1.5 tabular-nums">
                    <span className="h-2 w-2 flex-none rounded-full" style={{ background: r.color }} />
                    {r.name && <span className="text-white/70">{r.name}</span>}
                    <span className="ms-auto font-medium">{r.value}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          {legend.length > 0 && (
            <ul className="m-0 mt-3 flex list-none flex-wrap gap-x-4 gap-y-1.5 p-0 text-[12px] text-neutral-600">
              {legend.map((e, i) => (
                <li key={i} className="flex items-center gap-1.5">
                  <span aria-hidden className="h-2.5 w-2.5 rounded-sm" style={{ background: e.color }} />
                  {e.name}
                </li>
              ))}
            </ul>
          )}
          {!empty && specToReact(chartTable(data, title || text.fallbackTitle, text, locale))}
          {isEditable && dataOpen && <ChartDataEditor data={data} onChange={commitData} />}
        </figure>
      </EditorBlockFrame>
    </NodeViewWrapper>
  )
}
