'use client'
/*
 Scenarios block: a branching, choose-your-path story (Experiences family).

 Authoring is edit in place: step tabs (plus "+ Add step" and "View map"),
 then the current step as the learner's card, with its text and choice
 buttons editable where they sit and a small "Then…" pill under each choice.
 Problems show as inline chips on the step they affect (and a dot on its
 tab). The header holds the title, AI generate, the gear (Story / Chat) and
 the frame's "Preview as learner".

 Every edit reads the node's CURRENT attrs from the editor state and commits
 the result in one transaction, so collaborators' edits made in between are
 kept and undo works per change. The stored shape is the old one plus
 optional fields (see scenarioModel.ts).
*/
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import React from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import dynamic from 'next/dynamic'
import { ChatsCircle, Flag, GitBranch, TreeStructure, X } from '@phosphor-icons/react'
import { Segmented, SettingsField } from '../../Blocks/ui/BlockChrome'
import { cn } from '@/lib/utils'
import { AIButton } from '@components/Objects/AI/AIBrand'
import { useAISettings } from '@components/Hooks/useAIFeature'
import { buttonClass } from '@components/Dashboard/Shared/DashKit/buttons'
import { AddGhost, AnswerKeyHint, ExperienceFrame, SettingsGear, useExperienceEditable } from '../Experiences/shared'
import ScenarioPlayer from './ScenarioPlayer'
import ScenarioMap from './ScenarioMap'
import { IssueChip, ScenarioStepCard, useIssueText, type Commit } from './ScenarioStepCard'
import { MAX_STEPS, type ScenarioData, type ScenarioDisplay, addStep, displayOf, normalizeScenario, startIdOf, stepTitle, validateScenario } from './scenarioModel'

const AIScenarioGeneratorModal = dynamic(() => import('@components/Objects/AI/AIScenarioGeneratorModal'), { ssr: false })

const DEFAULT_TITLE = 'Interactive Scenario'

function sameJSON(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b)
}

const ScenariosExtension: React.FC<NodeViewProps> = (props) => {
  const isEditable = useExperienceEditable(props)
  const data = React.useMemo(() => normalizeScenario(props.node.attrs), [props.node.attrs])
  if (!isEditable) {
    return (
      <NodeViewWrapper className="block-scenarios">
        <LearnerScenario data={data} />
      </NodeViewWrapper>
    )
  }
  return <ScenarioEditor {...props} data={data} />
}

/** The old default title reads as no title. */
const shownTitle = (title: string) => (title && title !== DEFAULT_TITLE ? title : '')

function LearnerScenario({ data }: { data: ScenarioData }) {
  const { t } = useTranslation()
  const [status, setStatus] = React.useState({ live: '', celebrate: false })
  return (
    <ExperienceFrame
      tone="interactive"
      icon={<GitBranch weight="duotone" />}
      title={shownTitle(data.title) || t('editor.scenarios.interactive_scenario')}
      instructions={t('activities.experiences.scenarios.instructions', 'Pick what you would do. Each choice leads somewhere different.')}
      editable={false}
      live={status.live}
      celebrate={status.celebrate}
    >
      <ScenarioPlayer data={data} display={displayOf(data)} onStatus={setStatus} />
    </ExperienceFrame>
  )
}

function ScenarioEditor(props: NodeViewProps & { data: ScenarioData }) {
  const { t } = useTranslation()
  const issueText = useIssueText()
  const { data, editor, getPos, node, updateAttributes } = props
  const report = React.useMemo(() => validateScenario(data), [data])
  const [preview, setPreview] = React.useState(false)
  const [focusId, setFocusId] = React.useState<string | null>(null)
  const [mapOpen, setMapOpen] = React.useState(false)
  const [showAI, setShowAI] = React.useState(false)
  const [status, setStatus] = React.useState({ live: '', celebrate: false })
  // Settings > AI (unknown org: shown, the API decides).
  const ai = useAISettings()
  const scenarioAI = !ai || ai.features.assignment_generation
  const rootRef = React.useRef<HTMLDivElement>(null)
  const start = startIdOf(data)
  const display = displayOf(data)
  const activityUuid = (props.extension as any)?.options?.activity?.activity_uuid

  // Latest attrs for edits: the live node in the editor state, so an edit
  // never overwrites a collaborator's change that landed after our render.
  const commit: Commit = React.useCallback(
    (fn) => {
      const pos = typeof getPos === 'function' ? getPos() : undefined
      const live = typeof pos === 'number' ? editor.state.doc.nodeAt(pos) : null
      const base = normalizeScenario(live && live.type.name === 'scenarios' ? live.attrs : node.attrs)
      const next = fn(base)
      const patch: Record<string, unknown> = {}
      if (next.title !== base.title) patch.title = next.title
      if (!sameJSON(next.scenarios, base.scenarios)) patch.scenarios = next.scenarios
      if (next.currentScenarioId !== base.currentScenarioId) patch.currentScenarioId = next.currentScenarioId
      if (next.display && displayOf(next) !== displayOf(base)) patch.display = displayOf(next)
      if (Object.keys(patch).length) updateAttributes(patch)
    },
    [editor, getPos, node, updateAttributes],
  )

  // The step on the card: the one picked (tab, map, a new step), else the start.
  const [currentId, setCurrentId] = React.useState<string | null>(null)
  const current = data.scenarios.find((s) => s.id === currentId) ?? data.scenarios.find((s) => s.id === start) ?? data.scenarios[0]

  const focusStep = React.useCallback((id: string) => {
    setCurrentId(id)
    setFocusId(id)
    requestAnimationFrame(() => {
      rootRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    })
  }, [])

  const addNewStep = () => {
    let id = ''
    commit((d) => {
      const r = addStep(d, { options: [] })
      id = r.id
      return r.data
    })
    if (id) focusStep(id)
  }

  const globalIssues = report.issues.filter((i) => !i.stepId)

  const displaySetting = (
    <Segmented<ScenarioDisplay>
      ariaLabel={t('editor.experiences.scenarios.display_label', 'Layout')}
      value={display}
      onChange={(v) => commit((d) => ({ ...d, display: v }))}
      options={[
        { value: 'story', label: t('editor.experiences.scenarios.display_story', 'Story') },
        { value: 'chat', label: t('editor.experiences.scenarios.display_chat', 'Chat') },
      ]}
    />
  )
  const headerEnd = !preview ? (
    <div className="flex flex-none items-center gap-1.5">
      {scenarioAI && (
        <AIButton size="sm" onClick={() => setShowAI(true)}>
          <span className="max-sm:sr-only">{t('editor.scenarios.generate_with_ai')}</span>
        </AIButton>
      )}
      <SettingsGear>
        <SettingsField label={t('editor.experiences.scenarios.display_label', 'Layout')}>{displaySetting}</SettingsField>
      </SettingsGear>
    </div>
  ) : null

  return (
    <NodeViewWrapper className="block-scenarios">
      <ExperienceFrame
        nodeView={props}
        tone="interactive"
        icon={display === 'chat' ? <ChatsCircle weight="duotone" /> : <GitBranch weight="duotone" />}
        label={t('editor.blocks.scenario', 'Scenario')}
        title={preview ? shownTitle(data.title) || t('editor.scenarios.interactive_scenario') : data.title}
        titlePlaceholder={t('editor.scenarios.title_placeholder')}
        onTitleChange={(v) => commit((d) => ({ ...d, title: v }))}
        instructions={preview ? t('activities.experiences.scenarios.instructions', 'Pick what you would do. Each choice leads somewhere different.') : undefined}
        editable
        preview={preview}
        onPreviewChange={setPreview}
        headerEnd={headerEnd}
        live={preview ? status.live : undefined}
        celebrate={preview && status.celebrate}
        wysiwyg
        footer={preview ? undefined : <AnswerKeyHint>{t('editor.experiences.scenarios.editing_hint', 'You’re editing the story. Preview to play it as a learner.')}</AnswerKeyHint>}
      >
        {preview ? (
          <ScenarioPlayer data={data} display={display} onStatus={setStatus} />
        ) : (
          <div ref={rootRef} className="flex flex-col gap-4">
            {globalIssues.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {globalIssues.map((issue) => (
                  <IssueChip key={issue.code} level={issue.level}>
                    {issueText(issue, data)}
                  </IssueChip>
                ))}
              </div>
            )}
            {/* Steps: one tab each, then add and the map. */}
            <div role="tablist" aria-label={t('editor.experiences.scenarios.steps_label', 'Steps')} className="flex flex-wrap items-center gap-1.5">
              {data.scenarios.map((step, i) => {
                const on = step.id === current?.id
                const issues = report.byStep[step.id] ?? []
                const hasError = issues.some((x) => x.level === 'error')
                const title = stepTitle(step)
                return (
                  <button
                    key={step.id}
                    type="button"
                    role="tab"
                    aria-selected={on}
                    aria-label={title ? `${t('editor.blocks_v2.scenarios.step_n', { n: i + 1, defaultValue: 'Step {{n}}' })}: ${title}` : t('editor.blocks_v2.scenarios.step_n', { n: i + 1, defaultValue: 'Step {{n}}' })}
                    title={title || undefined}
                    onClick={() => setCurrentId(step.id)}
                    onKeyDown={(e) => {
                      const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
                      if (!dir) return
                      e.preventDefault()
                      const rtl = getComputedStyle(e.currentTarget).direction === 'rtl'
                      const next = data.scenarios[i + (rtl ? -dir : dir)]
                      if (!next) return
                      setCurrentId(next.id)
                      const list = e.currentTarget.parentElement
                      requestAnimationFrame(() => list?.querySelector<HTMLElement>(`[aria-selected="true"]`)?.focus())
                    }}
                    tabIndex={on ? 0 : -1}
                    className={cn(
                      'relative inline-flex h-7 min-w-7 items-center justify-center gap-1 rounded-full px-2 text-[12px] font-semibold tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40',
                      on ? 'lh-exp-raised text-neutral-900' : 'text-neutral-500 hover:bg-neutral-200/60 hover:text-neutral-800',
                    )}
                  >
                    {step.id === start && <Flag size={10} weight="fill" aria-hidden className="text-emerald-600" />}
                    {i + 1}
                    {issues.length > 0 && <span aria-hidden className={cn('absolute -end-0.5 -top-0.5 h-2 w-2 rounded-full', hasError ? 'bg-rose-500' : 'bg-amber-400')} />}
                  </button>
                )
              })}
              {data.scenarios.length < MAX_STEPS && (
                <AddGhost onClick={addNewStep} iconSize={12} className="h-7 rounded-full px-2.5 text-[12px]">
                  {t('editor.blocks_v2.scenarios.add_step', 'Add step')}
                </AddGhost>
              )}
              <span className="flex-1" />
              {data.scenarios.length > 1 && (
                <button
                  type="button"
                  onClick={() => setMapOpen(true)}
                  className="inline-flex h-7 items-center gap-1.5 rounded-lg px-2 text-[12.5px] font-medium text-neutral-500 outline-none hover:bg-neutral-200/60 hover:text-neutral-800 focus-visible:ring-2 focus-visible:ring-sky-500/40"
                >
                  <TreeStructure size={13} aria-hidden />
                  {t('editor.experiences.scenarios.view_map', 'View map')}
                </button>
              )}
            </div>
            {current && (
              <ScenarioStepCard
                key={current.id}
                data={data}
                step={current}
                issues={report.byStep[current.id] ?? []}
                isStart={current.id === start}
                commit={commit}
                onFocusStep={focusStep}
                autoFocusText={focusId === current.id && !current.text}
                chat={display === 'chat'}
              />
            )}
          </div>
        )}
      </ExperienceFrame>
      {mapOpen &&
        typeof document !== 'undefined' &&
        createPortal(
          <MapDialog
            title={data.title || t('editor.scenarios.interactive_scenario')}
            onClose={() => setMapOpen(false)}
          >
            <ScenarioMap
              data={data}
              report={report}
              selectedId={null}
              onSelect={(id) => {
                if (!id) return
                setMapOpen(false)
                focusStep(id)
              }}
            />
          </MapDialog>,
          document.body,
        )}
      {showAI && (
        <AIScenarioGeneratorModal
          isOpen={showAI}
          onClose={() => setShowAI(false)}
          onInsert={(block) => {
            // Keep the author's layout choice; the generator only knows steps.
            const next = normalizeScenario(block)
            commit((d) => ({ ...next, display: d.display }))
            setPreview(false)
          }}
          activityUuid={activityUuid}
        />
      )}
    </NodeViewWrapper>
  )
}

/** Read-only map (portal, not a Radix dialog, so node views are untouched). Clicking a step jumps to it. */
function MapDialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const { t } = useTranslation()
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
    }
  }, [onClose])
  return (
    <div
      className="fixed inset-0 flex bg-black/40 p-2 sm:p-6"
      style={{ zIndex: 'var(--z-modal)' }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      data-testid="scenario-map-expanded"
    >
      <div className="flex min-h-0 w-full flex-col overflow-hidden rounded-2xl bg-white shadow-[0_24px_60px_rgba(0,0,0,0.18)]">
        <div className="flex items-center gap-2.5 border-b border-neutral-100 px-4 py-2.5">
          <span className="flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-green-50 text-green-600">
            <TreeStructure size={17} weight="duotone" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[14px] font-semibold text-neutral-900">{title}</div>
            <div className="truncate text-[11.5px] text-neutral-400">{t('editor.experiences.scenarios.map_hint', 'Read-only. Click a step to jump to it.')}</div>
          </div>
          <button type="button" onClick={onClose} autoFocus className={buttonClass('secondary', 'sm')}>
            <X size={13} />
            <span className="max-sm:sr-only">{t('common.close', 'Close')}</span>
          </button>
        </div>
        <div className="relative min-h-0 flex-1">{children}</div>
      </div>
    </div>
  )
}

export default ScenariosExtension
