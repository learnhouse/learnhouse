/*
 Slash menu templates: ready-made tables with typed cells. The sample text
 is in the author's language and stays ordinary cell text.
*/
import React from 'react'
import { ListChecks, Scales, Exam } from '@phosphor-icons/react'
import i18n from '@/lib/i18n'
import type { SlashCommandItem } from '../types'
import { buildTableJSON, type CellSpec } from './tableModel'

const t = (key: string, fallback: string) => i18n.t(`editor.blocks_v2.table.sample.${key}`, fallback)
const typed = (text: string, attrs: Record<string, any>): CellSpec => ({ text, attrs })

export function progressTrackerTable() {
  // Explicit tones: the automatic one only knows a few languages' words.
  const status = (s: string, tone: string) => typed(s, { cellType: 'status', tone })
  const progress = (p: string) => typed(p, { cellType: 'progress' })
  return buildTableJSON(
    [
      [t('task', 'Task'), t('owner', 'Owner'), t('status', 'Status'), t('progress', 'Progress')],
      [t('task_1', 'Plan the lesson'), 'Sam', status(t('status_done', 'Done'), 'green'), progress('100')],
      [t('task_2', 'Record the video'), 'Ana', status(t('status_in_progress', 'In progress'), 'blue'), progress('60')],
      [t('task_3', 'Write the quiz'), 'Lee', status(t('status_todo', 'Not started'), 'gray'), progress('0')],
    ],
    { header: true, attrs: { totals: 'average' } },
  )
}

export function comparisonTable() {
  const check = (v: string) => typed(v, { cellType: 'checkbox', align: 'center' })
  const head = (v: string) => typed(v, { align: 'center' })
  return buildTableJSON(
    [
      [t('feature', 'Feature'), head(t('option_a', 'Basic')), head(t('option_b', 'Pro'))],
      [t('feature_1', 'Video lessons'), check('yes'), check('yes')],
      [t('feature_2', 'Quizzes'), check('yes'), check('yes')],
      [t('feature_3', 'Certificates'), check('no'), check('yes')],
    ],
    { header: true, attrs: { variant: 'striped' } },
  )
}

export function rubricTable() {
  const rating = (v: string) => typed(v, { cellType: 'rating' })
  const points = (v: string) => typed(v, { cellType: 'number', align: 'end' })
  return buildTableJSON(
    [
      [t('criterion', 'Criterion'), t('look_for', 'What we look for'), t('level', 'Level'), typed(t('points', 'Points'), { align: 'end' })],
      [t('crit_1', 'Clarity'), t('desc_1', 'Ideas are easy to follow'), rating('4/5'), points('8')],
      [t('crit_2', 'Accuracy'), t('desc_2', 'Facts and steps are correct'), rating('5/5'), points('10')],
      [t('crit_3', 'Structure'), t('desc_3', 'Clear sections in a logical order'), rating('3/5'), points('6')],
    ],
    { header: true, attrs: { variant: 'bordered', totals: 'sum' } },
  )
}

const item = (
  id: string,
  title: string,
  description: string,
  icon: React.ReactNode,
  keywords: string[],
  build: () => any,
): SlashCommandItem => ({
  id: `table-${id}`,
  title,
  description,
  titleKey: `editor.blocks_v2.table.templates.${id}.title`,
  descriptionKey: `editor.blocks_v2.table.templates.${id}.description`,
  icon,
  category: 'tables',
  keywords,
  command: (editor) => {
    editor.chain().focus().insertContent(build()).run()
  },
})

export const tableTemplateItems: SlashCommandItem[] = [
  item('progress', 'Progress tracker', 'Tasks with owners, status and progress bars', <ListChecks size={17} />, ['table', 'progress', 'tracker', 'tasks', 'status', 'project'], progressTrackerTable),
  item('comparison', 'Comparison', 'Compare options side by side with checkmarks', <Scales size={17} />, ['table', 'comparison', 'compare', 'versus', 'checklist', 'features'], comparisonTable),
  item('rubric', 'Rubric', 'Grading criteria with rating levels and points', <Exam size={17} />, ['table', 'rubric', 'grading', 'criteria', 'assessment', 'rating'], rubricTable),
]
