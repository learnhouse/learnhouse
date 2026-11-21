'use client'
/*
 What a suggestion changes, block by block: a word diff for text (inline or
 side by side), and before/after previews for other blocks (rendered with
 the learner renderer, so a quiz looks like a quiz). Used by the "Review your
 edit" step on the learner page and by the review queue.
*/
import React from 'react'
import dynamic from 'next/dynamic'
import { useTranslation } from 'react-i18next'
import { Minus, Plus, TextAa } from '@phosphor-icons/react'
import { blockChanges, formatOnly, type BlockChange, type DiffPart, type JSONNode } from './contributionModel'
import { blockConfig, textBlockTypes } from './blockRegistry'

const StaticCanva = dynamic(() => import('@components/Objects/Activities/StaticCanva/StaticCanva'), {
  ssr: false,
  loading: () => <div className="h-16 rounded-xl bg-neutral-100 animate-pulse" />,
})

export type DiffLayout = 'inline' | 'split'

function Parts({ parts, show }: { parts: DiffPart[]; show: 'both' | 'before' | 'after' }) {
  return (
    <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-neutral-800">
      {parts.map((part, i) => {
        if (part.kind === 'same') return <span key={i}>{part.text}</span>
        if (part.kind === 'del') {
          if (show === 'after') return null
          return (
            <del key={i} className="rounded-sm bg-rose-50 text-rose-700 decoration-rose-400">
              {part.text}
            </del>
          )
        }
        if (show === 'before') return null
        return (
          <ins key={i} className="rounded-sm bg-emerald-50 text-emerald-800 no-underline">
            {part.text}
          </ins>
        )
      })}
    </p>
  )
}

function Preview({ node, activity, tone }: { node: JSONNode; activity: any; tone: 'before' | 'after' }) {
  return (
    <div
      className={`pointer-events-none select-none overflow-hidden rounded-xl p-3 ring-1 ring-inset ${
        tone === 'before' ? 'bg-rose-50/40 ring-rose-200/70' : 'bg-emerald-50/40 ring-emerald-200/70'
      }`}
    >
      <StaticCanva content={{ type: 'doc', content: [node] }} activity={activity} />
    </div>
  )
}

function Label({ children, tone }: { children: React.ReactNode; tone: 'before' | 'after' | 'neutral' }) {
  const cls =
    tone === 'before' ? 'text-rose-700' : tone === 'after' ? 'text-emerald-700' : 'text-neutral-500'
  return <div className={`mb-1.5 text-[11px] font-semibold uppercase tracking-wide ${cls}`}>{children}</div>
}

export default function ContributionDiff({
  before,
  after,
  activity,
  layout = 'inline',
}: {
  before: JSONNode[]
  after: JSONNode[]
  activity: any
  layout?: DiffLayout
}) {
  const { t } = useTranslation()
  const changes = React.useMemo(() => blockChanges(before, after, textBlockTypes()), [before, after])
  const blockName = (node: JSONNode | undefined) => t(`contributions.blocks.${blockConfig(node?.type).label}`)

  const render = (change: BlockChange, k: number) => {
    if (change.kind === 'text') {
      const fmt = formatOnly(change, before[k], after[k])
      const unchanged = change.parts.every((p) => p.kind === 'same') && !fmt
      return (
        <div key={k} className={unchanged ? 'opacity-60' : ''}>
          {layout === 'split' && !unchanged ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label tone="before">{t('contributions.diff.before')}</Label>
                <Parts parts={change.parts} show="before" />
              </div>
              <div>
                <Label tone="after">{t('contributions.diff.after')}</Label>
                <Parts parts={change.parts} show="after" />
              </div>
            </div>
          ) : (
            <Parts parts={change.parts} show="both" />
          )}
          {fmt && (
            <p className="mt-1 inline-flex items-center gap-1 text-xs text-sky-700">
              <TextAa size={13} />
              {t('contributions.diff.format_only')}
            </p>
          )}
        </div>
      )
    }
    if (change.kind === 'added') {
      return (
        <div key={k}>
          <Label tone="after">
            <span className="inline-flex items-center gap-1">
              <Plus size={11} weight="bold" />
              {t('contributions.diff.added', { block: blockName(change.node) })}
            </span>
          </Label>
          <Preview node={change.node} activity={activity} tone="after" />
        </div>
      )
    }
    if (change.kind === 'removed') {
      return (
        <div key={k}>
          <Label tone="before">
            <span className="inline-flex items-center gap-1">
              <Minus size={11} weight="bold" />
              {t('contributions.diff.removed', { block: blockName(change.node) })}
            </span>
          </Label>
          <Preview node={change.node} activity={activity} tone="before" />
        </div>
      )
    }
    return (
      <div key={k}>
        <Label tone="neutral">{t('contributions.diff.changed', { block: blockName(change.after) })}</Label>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label tone="before">{t('contributions.diff.before')}</Label>
            <Preview node={change.before} activity={activity} tone="before" />
          </div>
          <div>
            <Label tone="after">{t('contributions.diff.after')}</Label>
            <Preview node={change.after} activity={activity} tone="after" />
          </div>
        </div>
      </div>
    )
  }

  if (!changes.length) {
    return <p className="text-sm text-neutral-500">{t('contributions.diff.nothing')}</p>
  }
  return <div className="space-y-4">{changes.map(render)}</div>
}
