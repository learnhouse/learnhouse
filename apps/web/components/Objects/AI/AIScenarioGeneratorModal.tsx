import React, { useCallback, useEffect, useState } from 'react'
import { ArrowElbowDownLeft, ArrowRight, CircleNotch, ClockCounterClockwise, GitBranch, MagicWand, Sparkle, Trash } from '@phosphor-icons/react'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import {
  generateAIScenario,
  fetchAIScenarioHistory,
  deleteAIScenarioHistory,
} from '@services/ai/generation'

// AI generator for the editor's `scenarios` (branching interactive) block.
// Generates a schema-valid decision tree, lets the author preview & tweak node
// text, then inserts it. Styled to match the ScenariosExtension.
interface ScenarioOption {
  id: string
  text: string
  nextScenarioId: string | null
}
interface Scenario {
  id: string
  text: string
  imageUrl?: string
  options: ScenarioOption[]
}
interface ScenarioBlock {
  title: string
  scenarios: Scenario[]
  currentScenarioId: string
}

interface AIScenarioGeneratorModalProps {
  isOpen: boolean
  onClose: () => void
  onInsert: (_block: ScenarioBlock) => void
  activityUuid?: string
}

interface ScenarioHistoryItem {
  ai_generation_uuid: string
  session_uuid?: string
  prompt: string
  scenario: ScenarioBlock
  creation_date?: string
}

const AIScenarioGeneratorModal: React.FC<AIScenarioGeneratorModalProps> = ({
  isOpen,
  onClose,
  onInsert,
  activityUuid,
}) => {
  const org = useOrg() as any
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token

  const [tab, setTab] = useState<'generate' | 'history'>('generate')
  const [prompt, setPrompt] = useState('')
  const [numScenarios, setNumScenarios] = useState(5)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [block, setBlock] = useState<ScenarioBlock | null>(null)
  const [sessionUuid, setSessionUuid] = useState<string | undefined>(undefined)

  const [history, setHistory] = useState<ScenarioHistoryItem[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)

  const loadHistory = useCallback(async () => {
    if (!org?.id || !access_token) return
    setHistoryLoading(true)
    const res = await fetchAIScenarioHistory(org.id, access_token)
    if (res.success && Array.isArray(res.data)) setHistory(res.data)
    setHistoryLoading(false)
  }, [org?.id, access_token])

  useEffect(() => {
    if (tab === 'history') loadHistory()
  }, [tab, loadHistory])

  const handleGenerate = async () => {
    if (!prompt.trim() || generating || !org?.id) return
    setGenerating(true)
    setError(null)
    try {
      const res = await generateAIScenario(
        {
          org_id: org.id,
          prompt: prompt.trim(),
          activity_uuid: activityUuid,
          session_uuid: sessionUuid,
          num_scenarios: numScenarios,
        },
        access_token
      )
      const detail = res.data?.detail
      const message = typeof detail === 'string' ? detail : 'Scenario generation failed. Please try again.'
      if (!res.success || !res.data?.scenario) {
        setError(message)
        return
      }
      setBlock(res.data.scenario)
      setSessionUuid(res.data.session_uuid)
    } catch {
      setError('Scenario generation failed. Please try again.')
    } finally {
      setGenerating(false)
    }
  }

  const updateNodeText = (id: string, value: string) => {
    if (!block) return
    setBlock({ ...block, scenarios: block.scenarios.map((s) => (s.id === id ? { ...s, text: value } : s)) })
  }
  const updateOptionText = (nodeId: string, optId: string, value: string) => {
    if (!block) return
    setBlock({
      ...block,
      scenarios: block.scenarios.map((s) =>
        s.id === nodeId
          ? { ...s, options: s.options.map((o) => (o.id === optId ? { ...o, text: value } : o)) }
          : s
      ),
    })
  }

  const handleInsert = () => {
    if (!block) return
    onInsert(block)
    onClose()
  }

  const handleDeleteHistory = async (uuid: string) => {
    if (!access_token) return
    await deleteAIScenarioHistory(uuid, access_token)
    setHistory((prev) => prev.filter((h) => h.ai_generation_uuid !== uuid))
  }

  const nodeLabel = (id: string, target: string | null) => {
    if (!target) return 'End'
    const idx = block?.scenarios.findIndex((s) => s.id === target)
    return idx != null && idx >= 0 ? `Node ${idx + 1}` : 'End'
  }

  const modalContent = (
    <div className="flex flex-col h-full">
      {/* Tabs */}
      <div className="flex items-center gap-1 px-4 pt-3">
        <button
          onClick={() => setTab('generate')}
          className={`px-3 py-1.5 rounded-lg text-sm flex items-center gap-1.5 transition-colors ${
            tab === 'generate' ? 'bg-neutral-900 text-white' : 'text-neutral-500 hover:bg-neutral-100'
          }`}
        >
          <MagicWand weight="duotone" size={15} /> Generate
        </button>
        <button
          onClick={() => setTab('history')}
          className={`px-3 py-1.5 rounded-lg text-sm flex items-center gap-1.5 transition-colors ${
            tab === 'history' ? 'bg-neutral-900 text-white' : 'text-neutral-500 hover:bg-neutral-100'
          }`}
        >
          <ClockCounterClockwise weight="duotone" size={15} /> History
        </button>
      </div>

      {tab === 'generate' ? (
        <>
          <div className="p-4 space-y-3 border-b border-neutral-100">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={2}
              placeholder={
                activityUuid
                  ? 'What should the scenario be about? (grounded on this activity)'
                  : 'What should the interactive scenario be about?'
              }
              className="w-full p-3 border border-neutral-200 rounded-xl resize-none focus:outline-hidden focus:ring-2 focus:ring-neutral-900/10 text-sm"
            />
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-1.5 text-xs text-neutral-500">
                Nodes
                <input
                  type="number"
                  min={2}
                  max={40}
                  value={numScenarios}
                  onChange={(e) => setNumScenarios(Number(e.target.value))}
                  className="w-16 p-1.5 border border-neutral-200 rounded-lg text-sm"
                />
              </label>
              <div className="grow" />
              <button
                onClick={handleGenerate}
                disabled={generating || !prompt.trim()}
                className="px-3 py-2 rounded-lg bg-neutral-900 text-white text-sm flex items-center gap-1.5 nice-shadow disabled:opacity-40 transition-opacity"
              >
                {generating ? <CircleNotch weight="duotone" size={15} className="animate-spin" /> : <Sparkle weight="duotone" size={15} />}
                {block ? 'Regenerate' : generating ? 'Generating' : 'Generate'}
              </button>
            </div>
            {error && <p className="text-xs text-rose-500">{error}</p>}
            <p className="text-[11px] text-neutral-400">Generating a scenario uses AI credits.</p>
          </div>

          {/* Editable preview */}
          <div className="flex-1 overflow-y-auto p-4 bg-neutral-50/50">
            {!block && !generating && (
              <p className="text-center text-sm text-neutral-400 mt-6">
                Your branching scenario will appear here to review before inserting.
              </p>
            )}
            {generating && <div className="w-full h-24 rounded-xl bg-neutral-100 animate-pulse" />}
            {block && (
              <div className="space-y-4">
                <p className="text-sm font-semibold text-neutral-700 flex items-center gap-1.5">
                  <GitBranch weight="duotone" size={15} className="text-neutral-400" /> {block.title}
                </p>
                {block.scenarios.map((node, ni) => (
                  <div key={node.id} className="bg-white rounded-lg p-4 nice-shadow">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs font-bold text-neutral-400">
                        Node {ni + 1}
                        {block.currentScenarioId === node.id && ' · start'}
                      </span>
                    </div>
                    <textarea
                      value={node.text}
                      onChange={(e) => updateNodeText(node.id, e.target.value)}
                      rows={2}
                      className="text-neutral-800 bg-transparent border-2 border-dashed border-neutral-200 rounded-lg text-sm w-full p-2 focus:border-neutral-300 outline-none transition-colors mb-2 resize-none"
                    />
                    <div className="space-y-1.5">
                      {node.options.map((opt) => (
                        <div key={opt.id} className="flex items-center gap-2 bg-neutral-50 border border-neutral-200 rounded-lg px-2 py-1.5">
                          <input
                            value={opt.text}
                            onChange={(e) => updateOptionText(node.id, opt.id, e.target.value)}
                            className="flex-1 text-neutral-700 bg-transparent border-0 text-sm outline-none"
                          />
                          <span className="text-[11px] text-neutral-400 flex items-center gap-1 whitespace-nowrap">
                            <ArrowRight weight="duotone" size={12} data-dir-flip /> {nodeLabel(node.id, opt.nextScenarioId)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {block && (
            <div className="border-t border-neutral-100 p-3 flex justify-end">
              <button
                onClick={handleInsert}
                className="px-4 py-2 rounded-lg bg-neutral-900 text-white text-sm flex items-center gap-1.5 nice-shadow"
              >
                <ArrowElbowDownLeft weight="duotone" size={15} data-dir-flip /> Insert into editor
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="flex-1 overflow-y-auto p-4">
          {historyLoading ? (
            <p className="text-center text-sm text-neutral-400 mt-6">Loading…</p>
          ) : history.length === 0 ? (
            <p className="text-center text-sm text-neutral-400 mt-6">No generated scenarios yet.</p>
          ) : (
            <div className="space-y-2">
              {history.map((h) => (
                <div key={h.ai_generation_uuid} className="flex items-center gap-3 bg-white rounded-lg p-3 nice-shadow">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-neutral-700 truncate">{h.prompt}</p>
                    <p className="text-[11px] text-neutral-400">{h.scenario?.scenarios?.length || 0} node(s)</p>
                  </div>
                  <button
                    onClick={() => {
                      setBlock(h.scenario)
                      setSessionUuid(h.session_uuid)
                      setTab('generate')
                    }}
                    className="px-3 py-1.5 rounded-lg bg-neutral-100 hover:bg-neutral-200 text-sm text-neutral-700"
                  >
                    Load
                  </button>
                  <button
                    onClick={() => handleDeleteHistory(h.ai_generation_uuid)}
                    className="p-1.5 rounded-lg hover:bg-neutral-100 text-neutral-400"
                    title="Delete"
                  >
                    <Trash weight="duotone" size={15} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )

  return (
    <Modal
      dialogTitle="Generate a scenario with AI"
      dialogContent={modalContent}
      onOpenChange={onClose}
      isDialogOpen={isOpen}
      minWidth="lg"
      minHeight="lg"
      customHeight="h-[80vh]"
      noPadding
    />
  )
}

export default AIScenarioGeneratorModal
