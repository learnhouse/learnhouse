'use client'
/*
 The chart's data grid: labels down the side, one column per series. Every
 cell commits on blur; a sheet pasted into any cell (or into the CSV box)
 replaces the whole table.
*/
import React from 'react'
import { ClipboardText, Plus, Trash, X } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { buttonClass } from '@components/Dashboard/Shared/DashKit/buttons'
import { cn } from '@/lib/utils'
import {
  addRow,
  addSeries,
  CHART_TONES,
  chartDataToCsv,
  csvToChartData,
  MAX_ROWS,
  MAX_SERIES,
  paletteIndex,
  parseNumber,
  removeRow,
  removeSeries,
  seriesColor,
  setCell,
  setLabel,
  setSeries,
  type ChartData,
} from '../chartModel'

const cell = 'h-8 w-full min-w-0 rounded-md bg-transparent px-2 text-[13px] text-neutral-800 outline-none hover:bg-neutral-50 focus:bg-white focus:shadow-[0_0_0_1px_rgba(0,0,0,0.2),0_0_0_3px_rgba(0,0,0,0.04)]'

function Cell({ value, onCommit, numeric, onPasteTable, ...rest }: { value: string; onCommit: (_v: string) => void; numeric?: boolean; onPasteTable: (_text: string) => boolean } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [draft, setDraft] = React.useState(value)
  const typing = React.useRef(false)
  React.useEffect(() => {
    if (!typing.current) setDraft(value)
  }, [value])
  return (
    <input
      {...rest}
      value={draft}
      inputMode={numeric ? 'decimal' : undefined}
      className={cn(cell, numeric && 'text-end tabular-nums')}
      onFocus={(e) => {
        typing.current = true
        e.currentTarget.select()
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        typing.current = false
        if (draft !== value) onCommit(draft)
      }}
      onPaste={(e) => {
        const text = e.clipboardData?.getData('text/plain') ?? ''
        if (/[\t\n]/.test(text.trim()) && onPasteTable(text)) e.preventDefault()
      }}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter' || e.key === 'Escape') {
          e.preventDefault()
          if (e.key === 'Escape') setDraft(value)
          ;(e.target as HTMLInputElement).blur()
        }
      }}
    />
  )
}

export default function ChartDataEditor({ data, onChange }: { data: ChartData; onChange: (_data: ChartData) => void }) {
  const { t } = useTranslation()
  const [csvOpen, setCsvOpen] = React.useState(false)
  const [csv, setCsv] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const seriesName = (i: number) => t('editor.blocks_v2.chart.series_n', 'Series {{n}}', { n: i + 1 })
  const rowName = (i: number) => t('editor.blocks_v2.chart.row_n', 'Item {{n}}', { n: i + 1 })

  const applyCsv = (text: string): boolean => {
    const parsed = csvToChartData(text, seriesName)
    if (!parsed || !parsed.labels.length || !parsed.series.length) {
      setError(t('editor.blocks_v2.chart.csv_error', 'Couldn’t read that table. Put labels in the first column and numbers in the others.'))
      return false
    }
    // Keep the colours already picked for series in the same place.
    parsed.series = parsed.series.map((s, i) => ({ ...s, tone: data.series[i]?.tone ?? null }))
    setError(null)
    onChange(parsed)
    return true
  }

  const nextTone = (i: number) => CHART_TONES[(paletteIndex(data.series[i]?.tone ?? null, i) + 1) % CHART_TONES.length]

  return (
    <div contentEditable={false} className="mt-3 rounded-xl bg-neutral-50/80 p-2.5 ring-1 ring-inset ring-neutral-200/70">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[320px] border-separate border-spacing-0.5 text-[13px]">
          <thead>
            <tr>
              <th scope="col" className="w-[34%] px-2 pb-1 text-start text-[11px] font-medium text-neutral-500">
                {t('editor.blocks_v2.chart.labels', 'Labels')}
              </th>
              {data.series.map((s, i) => (
                <th key={i} scope="col" className="min-w-[110px] pb-1 font-normal">
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => onChange(setSeries(data, i, { tone: nextTone(i) }))}
                      aria-label={t('editor.blocks_v2.chart.series_color', 'Change color of {{name}}', { name: s.name || seriesName(i) })}
                      title={t('editor.blocks_v2.chart.series_color', 'Change color of {{name}}', { name: s.name || seriesName(i) })}
                      className="h-4 w-4 flex-none rounded-full ring-2 ring-white outline-none focus-visible:ring-sky-400"
                      style={{ background: seriesColor(s, i) }}
                    />
                    <Cell value={s.name} placeholder={seriesName(i)} aria-label={t('editor.blocks_v2.chart.series_name', 'Series name')} onCommit={(v) => onChange(setSeries(data, i, { name: v }))} onPasteTable={applyCsv} />
                    {data.series.length > 1 && (
                      <button type="button" onClick={() => onChange(removeSeries(data, i))} aria-label={t('editor.blocks_v2.chart.remove_series', 'Remove series')} title={t('editor.blocks_v2.chart.remove_series', 'Remove series')} className="flex h-6 w-6 flex-none items-center justify-center rounded-md text-neutral-400 hover:bg-rose-50 hover:text-rose-600">
                        <X size={12} />
                      </button>
                    )}
                  </div>
                </th>
              ))}
              <th className="w-7" />
            </tr>
          </thead>
          <tbody>
            {data.labels.map((label, j) => (
              <tr key={j}>
                <th scope="row" className="font-normal">
                  <Cell value={label} placeholder={rowName(j)} aria-label={t('editor.blocks_v2.chart.label_n', 'Label {{n}}', { n: j + 1 })} onCommit={(v) => onChange(setLabel(data, j, v))} onPasteTable={applyCsv} />
                </th>
                {data.series.map((s, i) => (
                  <td key={i}>
                    <Cell
                      numeric
                      value={String(s.values[j] ?? 0)}
                      aria-label={`${label || rowName(j)}, ${s.name || seriesName(i)}`}
                      onCommit={(v) => {
                        const n = parseNumber(v)
                        onChange(setCell(data, i, j, n ?? 0))
                      }}
                      onPasteTable={applyCsv}
                    />
                  </td>
                ))}
                <td>
                  {data.labels.length > 1 && (
                    <button type="button" onClick={() => onChange(removeRow(data, j))} aria-label={t('editor.blocks_v2.chart.remove_row', 'Remove row')} title={t('editor.blocks_v2.chart.remove_row', 'Remove row')} className="flex h-7 w-7 items-center justify-center rounded-md text-neutral-400 hover:bg-rose-50 hover:text-rose-600">
                      <Trash size={13} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <button type="button" className={buttonClass('secondary', 'sm')} disabled={data.labels.length >= MAX_ROWS} onClick={() => onChange(addRow(data.series.length ? data : addSeries(data, seriesName(0)), rowName(data.labels.length)))}>
          <Plus size={12} weight="bold" />
          {t('editor.blocks_v2.chart.add_row', 'Add row')}
        </button>
        <button type="button" className={buttonClass('secondary', 'sm')} disabled={data.series.length >= MAX_SERIES} onClick={() => onChange(addSeries(data.labels.length ? data : addRow(data, rowName(0)), seriesName(data.series.length)))}>
          <Plus size={12} weight="bold" />
          {t('editor.blocks_v2.chart.add_series', 'Add series')}
        </button>
        <button
          type="button"
          className={buttonClass('ghost', 'sm')}
          aria-expanded={csvOpen}
          onClick={() => {
            setCsv(csvOpen ? '' : chartDataToCsv(data, t('editor.blocks_v2.chart.labels', 'Labels')))
            setCsvOpen(!csvOpen)
            setError(null)
          }}
        >
          <ClipboardText size={13} />
          {t('editor.blocks_v2.chart.paste_csv', 'Paste CSV')}
        </button>
      </div>
      {csvOpen && (
        <div className="mt-2 flex flex-col gap-2">
          <textarea
            value={csv}
            rows={5}
            onChange={(e) => setCsv(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            aria-label={t('editor.blocks_v2.chart.csv_label', 'Table as CSV')}
            placeholder={t('editor.blocks_v2.chart.csv_placeholder', 'Paste from a spreadsheet, or type: label, series 1, series 2')}
            className="w-full rounded-lg bg-white px-2.5 py-2 font-mono text-[12px] leading-relaxed text-neutral-800 shadow-[0_0_0_1px_rgba(0,0,0,0.1)] outline-none focus:shadow-[0_0_0_1px_rgba(0,0,0,0.25),0_0_0_3px_rgba(0,0,0,0.05)]"
          />
          <div className="flex items-center justify-end gap-1.5">
            <button type="button" className={buttonClass('ghost', 'sm')} onClick={() => setCsvOpen(false)}>
              {t('common.cancel', 'Cancel')}
            </button>
            <button type="button" className={buttonClass('primary', 'sm')} onClick={() => applyCsv(csv) && setCsvOpen(false)}>
              {t('editor.blocks_v2.chart.apply_csv', 'Use this data')}
            </button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="m-0 mt-2 text-xs text-rose-600">
          {error}
        </p>
      )}
    </div>
  )
}
