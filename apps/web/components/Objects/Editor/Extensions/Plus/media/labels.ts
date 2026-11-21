/*
 Learner-facing words the media nodes need outside React (renderHTML) and
 inside it (the views), built from any i18next-style `t`.
*/
import type { ChartText, ChartType } from './chartModel'
import type { MediaLabels } from './mediaNodes'
import { FILE_TYPES } from './mediaModel'

type T = (_key: string, _fallback: string, _vars?: Record<string, unknown>) => string

const TYPE_FALLBACK: Record<ChartType, string> = { bar: 'Bar chart', column: 'Column chart', line: 'Line chart', area: 'Area chart', pie: 'Pie chart', donut: 'Donut chart' }
const FILE_FALLBACK: Record<string, string> = { pdf: 'PDF', doc: 'Document', sheet: 'Spreadsheet', slides: 'Slides', archive: 'Archive', image: 'Image', audio: 'Audio', video: 'Video', text: 'Text', code: 'Code', file: 'File' }

export function chartText(t: T): ChartText {
  return {
    typeName: (type) => t(`activities.chart.types.${type}`, TYPE_FALLBACK[type]),
    summary: (p) => t('activities.chart.summary', '{{type}} with {{series}} series ({{names}}) over {{categories}} categories, from {{min}} to {{max}}.', p),
    fallbackTitle: t('activities.chart.title', 'Chart'),
    category: t('activities.chart.category', 'Category'),
    point: (p) => t('activities.chart.point', '{{label}}, {{series}}: {{value}}', p),
    slice: (p) => t('activities.chart.slice', '{{label}}: {{value}} ({{percent}})', p),
  }
}

export function mediaLabels(t: T, locale?: string): MediaLabels {
  return {
    before: t('activities.image_compare.before', 'Before'),
    after: t('activities.image_compare.after', 'After'),
    file: t('activities.file_card.file', 'File'),
    fileTypes: Object.fromEntries(FILE_TYPES.map((k) => [k, t(`activities.file_card.types.${k}`, FILE_FALLBACK[k])])),
    chart: chartText(t),
    locale,
  }
}
