'use client'
/*
 Scenarios block: a branching, choose-your-path story (Experiences family).

 Authoring is one "story builder" list: each step is a card, each choice has
 a single "Then…" select. Problems show as inline chips on the step they
 affect; "View map" opens the existing map read-only. The header holds only
 the title, Story/Chat, AI generate and the frame's "Preview as learner".

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
import { ChatsCircle, GitBranch, Plus, TreeStructure, X } from '@phosphor-icons/react'
import { Segmented } from '../../Blocks/ui/BlockChrome'
import { AIButton } from '@components/Objects/AI/AIBrand'
import { useAISettings } from '@components/Hooks/useAIFeature'
import { buttonClass } from '@components/Dashboard/Shared/DashKit/buttons'
import { ExperienceFrame, useExperienceEditable } from '../Experiences/shared'
import ScenarioPlayer from './ScenarioPlayer'
import ScenarioMap from './ScenarioMap'
import { IssueChip, ScenarioStepCard, useIssueText, type Commit } from './ScenarioStepCard'
import { MAX_CHOICES, MAX_STEPS, type ScenarioData, type ScenarioDisplay, addStep, displayOf, normalizeScenario, startIdOf, validateScenario } from './scenarioModel'

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

  // Briefly ring a step after jumping to it (new step, map click).
  React.useEffect(() => {
    if (!focusId) return
    const timer = window.setTimeout(() => setFocusId(null), 1800)
    return () => window.clearTimeout(timer)
  }, [focusId])

  const focusStep = React.useCallback((id: string) => {
    setFocusId(id)
    requestAnimationFrame(() => {
      rootRef.current?.querySelector(`[data-step-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
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

  const headerEnd = !preview ? (
    <div className="flex flex-none items-center gap-1.5">
      <div className="w-[8.5rem] max-sm:hidden">
        <Segmented<ScenarioDisplay>
          ariaLabel={t('editor.experiences.scenarios.display_label', 'Layout')}
          value={display}
          onChange={(v) => commit((d) => ({ ...d, display: v }))}
          options={[
            { value: 'story', label: t('editor.experiences.scenarios.display_story', 'Story') },
            { value: 'chat', label: t('editor.experiences.scenarios.display_chat', 'Chat') },
          ]}
        />
      </div>
      {scenarioAI && (
        <AIButton size="sm" onClick={() => setShowAI(true)}>
          <span className="max-sm:sr-only">{t('editor.scenarios.generate_with_ai')}</span>
        </AIButton>
      )}
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
      >
        {preview ? (
          <ScenarioPlayer data={data} display={display} onStatus={setStatus} />
        ) : (
          <div ref={rootRef} className="flex flex-col gap-2.5">
            {/* Phones: Story/Chat lives here (the header is narrow). */}
            <div className="sm:hidden">
              <Segmented<ScenarioDisplay>
                ariaLabel={t('editor.experiences.scenarios.display_label', 'Layout')}
                value={display}
                onChange={(v) => commit((d) => ({ ...d, display: v }))}
                options={[
                  { value: 'story', label: t('editor.experiences.scenarios.display_story', 'Story') },
                  { value: 'chat', label: t('editor.experiences.scenarios.display_chat', 'Chat') },
                ]}
              />
            </div>
            {globalIssues.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {globalIssues.map((issue) => (
                  <IssueChip key={issue.code} level={issue.level}>
                    {issueText(issue, data)}
                  </IssueChip>
                ))}
              </div>
            )}
            {data.scenarios.map((step) => (
              <ScenarioStepCard
                key={step.id}
                data={data}
                step={step}
                issues={report.byStep[step.id] ?? []}
                isStart={step.id === start}
                commit={commit}
                onFocusStep={focusStep}
                highlighted={focusId === step.id}
                autoFocusText={focusId === step.id && !step.text}
              />
            ))}
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={addNewStep}
                disabled={data.scenarios.length >= MAX_STEPS}
                className={buttonClass('secondary', 'sm')}
                title={data.scenarios.length >= MAX_STEPS ? t('editor.scenarios.max_scenarios') : undefined}
              >
                <Plus size={13} />
                {t('editor.blocks_v2.scenarios.add_step', 'Add step')}
              </button>
              {data.scenarios.length > 1 && (
                <button type="button" onClick={() => setMapOpen(true)} className={buttonClass('ghost', 'sm')}>
                  <TreeStructure size={13} />
                  {t('editor.experiences.scenarios.view_map', 'View map')}
                </button>
              )}
              <span className="ms-auto text-[11px] text-neutral-400 max-sm:hidden">
                {t('editor.blocks_v2.scenarios.limits', { max: MAX_STEPS, choices: MAX_CHOICES, defaultValue: 'Up to {{max}} steps, {{choices}} choices each.' })}
              </span>
            </div>
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
