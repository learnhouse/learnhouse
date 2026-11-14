'use client'
/*
 Scenarios block: a branching, choose-your-path exercise.

 Editor: steps edited in place (Steps), a visual map with a side panel (Map,
 also full screen), and the learner player (Preview). Every edit reads the
 node's CURRENT attrs from the editor state and commits the result in one
 transaction, so collaborators' edits made in between are kept and undo
 works per change. Text commits on blur, never per keystroke.

 Learners get ScenarioPlayer. The stored shape is unchanged.
*/
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import React from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import dynamic from 'next/dynamic'
import { ArrowsIn, ArrowsOut, CheckCircle, GitBranch, ListBullets, Play, Plus, TreeStructure, Warning, X } from '@phosphor-icons/react'
import EditorBlockFrame from '../../Blocks/ui/EditorBlockFrame'
import { BlockPopover, CommitInput, Segmented } from '../../Blocks/ui/BlockChrome'
import { AIButton } from '@components/Objects/AI/AIBrand'
import { useEditorProvider } from '@components/Contexts/Editor/EditorContext'
import { buttonClass } from '@components/Dashboard/Shared/DashKit/buttons'
import { cn } from '@/lib/utils'
import ScenarioPlayer from './ScenarioPlayer'
import ScenarioMap from './ScenarioMap'
import { ScenarioStepCard, useIssueText, type Commit } from './ScenarioStepCard'
import {
  MAX_STEPS,
  ScenarioData,
  addStep,
  isEnding,
  normalizeScenario,
  startIdOf,
  stepById,
  validateScenario,
} from './scenarioModel'

const AIScenarioGeneratorModal = dynamic(() => import('@components/Objects/AI/AIScenarioGeneratorModal'), { ssr: false })

type View = 'steps' | 'map' | 'preview'

function sameJSON(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b)
}

const ScenariosExtension: React.FC<NodeViewProps> = (props) => {
  const editorState = useEditorProvider() as any
  const isEditable = editorState?.isEditable ?? true
  const data = React.useMemo(() => normalizeScenario(props.node.attrs), [props.node.attrs])

  if (!isEditable) {
    return (
      <NodeViewWrapper className="block-scenarios">
        <ScenarioPlayer data={data} />
      </NodeViewWrapper>
    )
  }
  return <ScenarioEditor {...props} data={data} />
}

function ScenarioEditor(props: NodeViewProps & { data: ScenarioData }) {
  const { t } = useTranslation()
  const { data, editor, getPos, node, updateAttributes } = props
  const report = React.useMemo(() => validateScenario(data), [data])
  const issueText = useIssueText()
  const [view, setView] = React.useState<View>('steps')
  const [selected, setSelected] = React.useState<string | null>(null)
  const [expanded, setExpanded] = React.useState(false)
  const [focusId, setFocusId] = React.useState<string | null>(null)
  const [issuesOpen, setIssuesOpen] = React.useState(false)
  const [showAI, setShowAI] = React.useState(false)
  const rootRef = React.useRef<HTMLDivElement>(null)
  const start = startIdOf(data)
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
      if (Object.keys(patch).length) updateAttributes(patch)
    },
    [editor, getPos, node, updateAttributes],
  )

  // Briefly ring a step after jumping to it (new step, issue list, "jump to").
  React.useEffect(() => {
    if (!focusId) return
    const timer = window.setTimeout(() => setFocusId(null), 1800)
    return () => window.clearTimeout(timer)
  }, [focusId])

  // The selected step can disappear (deleted here or by a collaborator).
  if (selected && !stepById(data, selected)) setSelected(null)

  const focusStep = React.useCallback(
    (id: string) => {
      if (view === 'map' || expanded) {
        setSelected(id)
        return
      }
      setFocusId(id)
      requestAnimationFrame(() => {
        rootRef.current?.querySelector(`[data-step-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      })
    },
    [view, expanded],
  )

  const addNewStep = () => {
    let id = ''
    commit((d) => {
      const r = addStep(d, { options: [] })
      id = r.id
      return r.data
    })
    if (id) focusStep(id)
  }

  const errors = report.issues.filter((i) => i.level === 'error').length
  const warnings = report.issues.length - errors
  const endings = data.scenarios.filter(isEnding).length + (data.scenarios.some((s) => s.options.some((o) => o.nextScenarioId === null)) ? 1 : 0)

  // Original look: grey panel, uppercase label, the AI + edit actions on the right.
  const header = (
    <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
      <div className="flex items-center gap-2">
        <GitBranch weight="duotone" className="text-neutral-400" size={16} />
        <span className="text-[12px] font-semibold text-neutral-500">{t('editor.scenarios.interactive_scenario')}</span>
      </div>
      {report.issues.length > 0 ? (
        <BlockPopover
          open={issuesOpen}
          onOpenChange={setIssuesOpen}
          width={320}
          title={t('editor.blocks_v2.scenarios.check', 'Path check')}
          trigger={
            <button
              type="button"
              className={cn(
                'inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-[12px] font-medium ring-1',
                errors ? 'bg-rose-50 text-rose-700 ring-rose-600/15' : 'bg-amber-50 text-amber-800 ring-amber-600/15',
              )}
            >
              <Warning size={13} weight="fill" />
              {t('editor.blocks_v2.scenarios.issue_count', { count: report.issues.length, defaultValue: '{{count}} issues' })}
            </button>
          }
        >
          <ul className="-mx-1 flex max-h-72 flex-col gap-0.5 overflow-y-auto">
            {report.issues.map((issue, i) => {
              const idx = issue.stepId ? data.scenarios.findIndex((s) => s.id === issue.stepId) : -1
              return (
                <li key={i}>
                  <button
                    type="button"
                    disabled={!issue.stepId}
                    onClick={() => {
                      setIssuesOpen(false)
                      if (issue.stepId) focusStep(issue.stepId)
                    }}
                    className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-start text-[12px] hover:bg-neutral-100 disabled:hover:bg-transparent"
                  >
                    <Warning size={13} weight="fill" className={cn('mt-0.5 flex-none', issue.level === 'error' ? 'text-rose-500' : 'text-amber-500')} />
                    <span className="flex-1 text-neutral-700">
                      {idx >= 0 && (
                        <span className="me-1 font-semibold text-neutral-900">
                          {t('editor.blocks_v2.scenarios.step_n', { n: idx + 1, defaultValue: 'Step {{n}}' })}:
                        </span>
                      )}
                      {issueText(issue, data)}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
          <p className="text-[11px] text-neutral-400">
            {t('editor.blocks_v2.scenarios.check_hint', { errors, warnings, defaultValue: '{{errors}} blocking, {{warnings}} to review.' })}
          </p>
        </BlockPopover>
      ) : (
        data.scenarios.length > 0 && (
          <span className="inline-flex h-7 items-center gap-1 rounded-full bg-emerald-50 px-2.5 text-[12px] font-medium text-emerald-700 ring-1 ring-emerald-600/15">
            <CheckCircle size={13} weight="fill" />
            {t('editor.blocks_v2.scenarios.all_paths_ok', 'Every path ends')}
          </span>
        )
      )}
      <div className="grow" />
      <div className="w-full sm:w-[15.5rem]">
        <Segmented<View>
          ariaLabel={t('editor.blocks_v2.scenarios.view', 'View')}
          value={view}
          onChange={setView}
          options={[
            { value: 'steps', label: <><ListBullets size={13} />{t('editor.blocks_v2.scenarios.view_steps', 'Steps')}</> },
            { value: 'map', label: <><TreeStructure size={13} />{t('editor.blocks_v2.scenarios.view_map', 'Map')}</> },
            { value: 'preview', label: <><Play size={13} />{t('editor.preview')}</> },
          ]}
        />
      </div>
      <AIButton size="sm" onClick={() => setShowAI(true)}>
        {t('editor.scenarios.generate_with_ai')}
      </AIButton>
    </div>
  )

  const titleField = (
    <div className="mb-3">
      <CommitInput
        value={data.title}
        aria-label={t('editor.scenarios.title_label')}
        placeholder={t('editor.scenarios.title_placeholder')}
        className="w-full rounded-lg border-2 border-dashed border-neutral-200 bg-transparent p-2 text-base font-semibold text-neutral-800 outline-none transition-colors focus:border-neutral-300"
        onCommit={(v) => commit((d) => ({ ...d, title: v }))}
      />
      <div className="mt-1.5 px-1 text-[11px] text-neutral-400">
        {t('editor.blocks_v2.scenarios.steps_count', { count: data.scenarios.length, defaultValue: '{{count}} steps' })}
        {' · '}
        {t('editor.blocks_v2.scenarios.endings_count', { count: endings, defaultValue: '{{count}} endings' })}
      </div>
    </div>
  )

  const selectedStep = stepById(data, selected)
  const sidePanel = (fill: boolean) =>
    selectedStep ? (
      <div
        className={cn(
          'flex min-h-0 flex-col border-neutral-100 bg-white',
          fill ? 'w-full border-t sm:h-full sm:w-[340px] sm:flex-none sm:border-s sm:border-t-0' : 'w-full border-t sm:h-full sm:w-[300px] sm:flex-none sm:border-s sm:border-t-0',
        )}
        data-testid="scenario-side-panel"
      >
        <div className="flex items-center gap-2 px-3 pb-1 pt-2.5">
          <span className="text-[12px] font-semibold text-neutral-500">
            {t('editor.blocks_v2.scenarios.edit_step', 'Edit step')}
          </span>
          <button
            type="button"
            onClick={() => setSelected(null)}
            aria-label={t('common.close', 'Close')}
            className="ms-auto inline-flex h-7 w-7 items-center justify-center rounded-lg text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
          >
            <X size={14} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          <ScenarioStepCard
            key={selectedStep.id}
            bare
            data={data}
            step={selectedStep}
            issues={report.byStep[selectedStep.id] ?? []}
            isStart={selectedStep.id === start}
            commit={commit}
            onFocusStep={setSelected}
          />
        </div>
      </div>
    ) : (
      <div className="hidden w-[220px] flex-none flex-col justify-center gap-1 border-s border-neutral-100 bg-white px-4 text-[12px] text-neutral-400 md:flex">
        <TreeStructure size={18} weight="duotone" className="text-neutral-300" />
        {t('editor.blocks_v2.scenarios.map_hint', 'Click a step to edit it here. Arrows show where each choice leads.')}
      </div>
    )

  const addStepButton = (
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
  )

  let body: React.ReactNode
  if (view === 'preview') {
    body = (
      <ScenarioPlayer data={data} />
    )
  } else if (view === 'map') {
    body = (
      <div className="flex flex-col overflow-hidden rounded-lg border border-neutral-200 sm:h-[460px] sm:flex-row">
        <div className="relative h-[380px] min-w-0 sm:h-full sm:flex-1">
          <ScenarioMap data={data} report={report} selectedId={selected} onSelect={setSelected} />
          <div className="absolute bottom-2 end-2 flex items-center gap-1">
            {addStepButton}
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className={buttonClass('secondary', 'icon')}
              aria-label={t('editor.blocks_v2.expand', 'Expand')}
              title={t('editor.blocks_v2.expand', 'Expand')}
            >
              <ArrowsOut size={14} />
            </button>
          </div>
        </div>
        {sidePanel(false)}
      </div>
    )
  } else {
    body = (
      <div className="flex flex-col gap-2.5">
        {data.scenarios.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <GitBranch size={24} weight="duotone" className="text-green-600/60" />
            <div className="text-[13px] font-medium text-neutral-700">{t('editor.scenarios.empty_title')}</div>
            <p className="text-[12px] text-neutral-500">{t('editor.scenarios.empty_hint')}</p>
          </div>
        ) : (
          data.scenarios.map((step) => (
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
          ))
        )}
        <div className="flex items-center gap-2">
          {addStepButton}
          <span className="text-[11px] text-neutral-400">
            {t('editor.blocks_v2.scenarios.limits', { max: MAX_STEPS, choices: 4, defaultValue: 'Up to {{max}} steps, {{choices}} choices each.' })}
          </span>
        </div>
      </div>
    )
  }

  return (
    <NodeViewWrapper className="block-scenarios">
      <EditorBlockFrame
        editable
        node={node}
        editor={editor}
        getPos={getPos}
        selected={props.selected}
        tone="interactive"
        label={t('editor.blocks.scenario', 'Scenario')}
      >
        <div ref={rootRef} data-lhb-panel="" className="rounded-xl bg-neutral-50 px-3 py-4 nice-shadow transition-all ease-linear sm:px-5">
          {header}
          {view === 'preview' ? (
            body
          ) : (
            <div className="rounded-lg bg-white p-3 nice-shadow sm:p-4">
              {titleField}
              {body}
            </div>
          )}
        </div>
        {expanded &&
          typeof document !== 'undefined' &&
          createPortal(
            <ExpandedMap
              title={data.title || t('editor.scenarios.interactive_scenario')}
              onClose={() => setExpanded(false)}
              addStepButton={addStepButton}
            >
              <div className="relative min-h-[320px] min-w-0 flex-1 sm:h-full">
                <ScenarioMap data={data} report={report} selectedId={selected} onSelect={setSelected} />
              </div>
              {sidePanel(true)}
            </ExpandedMap>,
            document.body,
          )}
        {showAI && (
          <AIScenarioGeneratorModal
            isOpen={showAI}
            onClose={() => setShowAI(false)}
            onInsert={(block) => {
              const next = normalizeScenario(block)
              commit(() => next)
              setView('steps')
            }}
            activityUuid={activityUuid}
          />
        )}
      </EditorBlockFrame>
    </NodeViewWrapper>
  )
}

/** Full-screen map (portal, not a Radix dialog, so node views are untouched). */
function ExpandedMap({
  title,
  onClose,
  addStepButton,
  children,
}: {
  title: string
  onClose: () => void
  addStepButton: React.ReactNode
  children: React.ReactNode
}) {
  const { t } = useTranslation()
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('[data-radix-popper-content-wrapper]')) onClose()
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
          <div className="min-w-0 flex-1 truncate text-[14px] font-semibold text-neutral-900">{title}</div>
          {addStepButton}
          <button type="button" onClick={onClose} className={buttonClass('secondary', 'sm')}>
            <ArrowsIn size={13} />
            <span className="hidden sm:inline">{t('editor.blocks_v2.collapse', 'Collapse')}</span>
          </button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto sm:flex-row sm:overflow-hidden">{children}</div>
      </div>
    </div>
  )
}

export default ScenariosExtension
