/*
 Slash menu entries for the media and data blocks. Charts and stats start
 filled with sample data, the quote with a sample testimonial (all in the
 author's language); the gallery and comparison open on their "Add images"
 empty state.
*/
import React from 'react'
import { ChartBar, ChartLineUp, Images, Paperclip, Quotes, SquareSplitHorizontal, TextIndent } from '@phosphor-icons/react'
import i18n from '@/lib/i18n'
import type { SlashCommandItem } from '../types'
import { sampleChartData } from './chartModel'
import { newId, sampleQuote, sampleStats } from './mediaModel'

const t = (key: string, fallback: string) => String(i18n.t(key, fallback))

const item = (
  id: string,
  key: string,
  title: string,
  description: string,
  icon: React.ReactNode,
  category: SlashCommandItem['category'],
  keywords: string[],
  command: SlashCommandItem['command'],
): SlashCommandItem => ({
  id,
  title,
  description,
  titleKey: `editor.slash_menu.items.${key}.title`,
  descriptionKey: `editor.slash_menu.items.${key}.description`,
  icon,
  category,
  keywords,
  command,
})

const insert = (build: () => any): SlashCommandItem['command'] => (editor) => {
  editor.chain().focus().insertContent(build()).run()
}

export const starterGallery = () => ({ type: 'gallery', attrs: { blockId: newId('gal'), layout: 'grid', columns: 3, images: [] } })
export const starterImageCompare = () => ({ type: 'imageCompare', attrs: { before: { label: '' }, after: { label: '' }, start: 50, orientation: 'horizontal' } })
export const starterChart = () => ({
  type: 'chart',
  attrs: { type: 'column', title: t('editor.blocks_v2.chart.sample.title', 'Average quiz score by quarter'), data: sampleChartData(t), showLegend: true, showValues: false, stacked: false },
})
export const starterStats = () => ({ type: 'statHighlights', attrs: { items: sampleStats(t), columns: 3, animate: true } })
export const starterFileCard = () => ({ type: 'fileCard' })
export const starterQuote = () => sampleQuote(t)

export const mediaSlashItems: SlashCommandItem[] = [
  item('gallery', 'gallery', 'Gallery', 'Several images in a grid or carousel', <Images size={17} />, 'media', ['gallery', 'images', 'photos', 'carousel', 'slideshow', 'grid', 'masonry'], insert(starterGallery)),
  item('imageCompare', 'image_compare', 'Image compare', 'Before and after with a slider', <SquareSplitHorizontal size={17} />, 'media', ['compare', 'before', 'after', 'slider', 'comparison', 'difference'], insert(starterImageCompare)),
  item('fileCard', 'file_card', 'File download', 'A file learners can download', <Paperclip size={17} />, 'media', ['file', 'download', 'attachment', 'document', 'resource'], insert(starterFileCard)),
  item('quoteBlock', 'quote_block', 'Testimonial', 'A pull quote or testimonial with its author', <Quotes size={17} />, 'media', ['quote', 'testimonial', 'pull quote', 'citation', 'review'], insert(starterQuote)),
  item('quote', 'quote', 'Quote', 'A simple quoted passage', <TextIndent size={17} />, 'media', ['quote', 'blockquote', 'citation'], (editor) => {
    editor.chain().focus().toggleWrap('blockquote').run()
  }),
  item('chart', 'chart', 'Chart', 'Bar, line or pie chart from a small table', <ChartLineUp size={17} />, 'data', ['chart', 'graph', 'bar', 'line', 'pie', 'donut', 'data', 'plot'], insert(starterChart)),
  item('statHighlights', 'stat_highlights', 'Stats', 'Big numbers that count up', <ChartBar size={17} />, 'data', ['stats', 'numbers', 'kpi', 'metrics', 'figures', 'highlights'], insert(starterStats)),
]
