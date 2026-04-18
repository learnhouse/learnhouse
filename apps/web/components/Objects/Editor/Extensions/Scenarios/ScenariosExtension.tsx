import { NodeViewWrapper } from '@tiptap/react'
import React, { useState } from 'react'
import { RotateCcw, ArrowRight, CheckCircle, GitBranch, RefreshCcw } from 'lucide-react'
import { useEditorProvider } from '@components/Contexts/Editor/EditorContext'
import ScenariosModal from './ScenariosModal'

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

const ScenariosExtension: React.FC = (props: any) => {
  const [title, setTitle] = useState(props.node.attrs.title)
  const [scenarios, setScenarios] = useState<Scenario[]>(props.node.attrs.scenarios)
  const [currentScenarioId, setCurrentScenarioId] = useState(props.node.attrs.currentScenarioId)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [scenarioComplete, setScenarioComplete] = useState(false)
  const editorState = useEditorProvider() as any
  const isEditable = editorState?.isEditable ?? true

  const getCurrentScenario = (scenarioId: string = currentScenarioId): Scenario | null => {
    return scenarios.find(s => s.id === scenarioId) || null
  }

  const handleSave = (newTitle: string, newScenarios: Scenario[], newCurrentScenarioId: string) => {
    setTitle(newTitle)
    setScenarios(newScenarios)
    setCurrentScenarioId(newCurrentScenarioId)

    props.updateAttributes({
      title: newTitle,
      scenarios: newScenarios,
      currentScenarioId: newCurrentScenarioId,
    })
  }

  const handleOptionClick = (nextScenarioId: string | null) => {
    if (nextScenarioId) {
      setCurrentScenarioId(nextScenarioId)
      setScenarioComplete(false)
    } else {
      setScenarioComplete(true)
    }
  }

  const resetScenario = () => {
    setCurrentScenarioId(scenarios[0]?.id || '1')
    setScenarioComplete(false)
  }

  const getOptionLetter = (index: number) => {
    return String.fromCharCode('A'.charCodeAt(0) + index)
  }

  return (
    <NodeViewWrapper className="block-scenarios">
      <div className="bg-neutral-50 rounded-xl px-5 py-4 nice-shadow transition-all ease-linear">
        {/* Header section */}
        <div className="flex flex-wrap gap-2 items-center text-sm mb-3">
          <div className="flex items-center gap-2">
            <GitBranch className="text-neutral-400" size={16} />
            <span className="uppercase tracking-widest text-xs font-bold text-neutral-400">
              Interactive Scenario
            </span>
          </div>

          {/* Completion message */}
          {scenarioComplete && !isEditable && (
            <div className="text-xs font-medium px-2 py-1 rounded-md bg-emerald-100 text-emerald-700">
              Scenario Complete!
            </div>
          )}

          <div className="grow"></div>

          {/* Action buttons */}
          {isEditable ? (
            <button
              onClick={() => setIsModalOpen(true)}
              className="bg-neutral-200 hover:bg-neutral-300 text-neutral-700 font-medium py-1.5 px-3 rounded-lg text-xs transition-colors outline-none"
            >
              Edit Scenarios
            </button>
          ) : (
            <button
              onClick={resetScenario}
              className="p-1.5 rounded-md hover:bg-neutral-200 transition-colors"
              title="Reset scenario"
            >
              <RefreshCcw className="text-neutral-500" size={15} />
            </button>
          )}
        </div>

        {/* Scenario content */}
        {isEditable ? (
          <div className="bg-white rounded-lg p-4 nice-shadow">
            <input
              value={title}
              placeholder="Scenario Title"
              onChange={(e) => {
                setTitle(e.target.value)
                props.updateAttributes({ title: e.target.value })
              }}
              className="text-neutral-800 bg-transparent border-2 border-dashed border-neutral-200 rounded-lg text-base font-semibold w-full p-2 focus:border-neutral-300 outline-none transition-colors mb-3"
            />

            <div className="p-4 bg-neutral-50 rounded-lg border border-neutral-200">
              <p className="text-neutral-600 text-sm text-center">
                {scenarios.length}/40 scenarios configured
              </p>
              <p className="text-neutral-500 text-xs text-center mt-1">
                Click "Edit Scenarios" to configure your interactive branching story
              </p>
            </div>
          </div>
        ) : scenarioComplete ? (
          <div className="bg-white rounded-lg p-6 nice-shadow text-center">
            <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle size={28} className="text-emerald-600" />
            </div>
            <h4 className="text-xl font-bold text-neutral-900 mb-2">Scenario Complete!</h4>
            <p className="text-neutral-600 mb-6 leading-relaxed max-w-md mx-auto">
              You've successfully navigated through this interactive scenario.
            </p>
            <button
              onClick={resetScenario}
              className="inline-flex items-center gap-2 px-4 py-2 bg-neutral-700 hover:bg-neutral-800 text-white rounded-lg transition-colors font-medium text-sm"
            >
              <RotateCcw size={16} />
              Start Over
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {(() => {
              const currentScenario = getCurrentScenario()
              if (!currentScenario) {
                return (
                  <div className="bg-white rounded-lg p-6 nice-shadow text-center">
                    <div className="w-12 h-12 bg-neutral-100 rounded-full flex items-center justify-center mx-auto mb-3">
                      <GitBranch size={20} className="text-neutral-400" />
                    </div>
                    <h3 className="text-base font-medium text-neutral-900 mb-2">Scenario Not Found</h3>
                    <p className="text-neutral-500 text-sm">Please check your scenario configuration and try again.</p>
                  </div>
                )
              }

              return (
                <>
                  {/* Scenario Text */}
                  <div className="bg-white rounded-lg p-5 nice-shadow">
                    {currentScenario.imageUrl && (
                      <div className="mb-4">
                        <img
                          src={currentScenario.imageUrl}
                          alt="Scenario illustration"
                          className="w-full h-48 object-cover rounded-lg border border-neutral-200"
                          onError={(e) => {
                            e.currentTarget.style.display = 'none'
                          }}
                        />
                      </div>
                    )}
                    <p className="text-base text-neutral-800 leading-relaxed font-medium">
                      {currentScenario.text}
                    </p>
                  </div>

                  {/* Response Options */}
                  <div className="space-y-2">
                    {currentScenario.options.map((option, index) => (
                      <button
                        key={option.id}
                        onClick={() => handleOptionClick(option.nextScenarioId)}
                        className="w-full bg-white border border-neutral-200 hover:border-blue-300 hover:bg-blue-50 rounded-lg p-3 transition-all group text-start nice-shadow"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-7 h-7 bg-neutral-100 group-hover:bg-blue-100 rounded-md flex items-center justify-center flex-shrink-0 transition-colors">
                            <span className="text-sm font-bold text-neutral-600 group-hover:text-blue-600">
                              {getOptionLetter(index)}
                            </span>
                          </div>
                          <div className="flex-1 text-neutral-700 font-medium group-hover:text-blue-900 transition-colors">
                            {option.text}
                          </div>
                          <ArrowRight size={16} className="text-neutral-400 group-hover:text-blue-500 group-hover:translate-x-1 transition-all" />
                        </div>
                      </button>
                    ))}
                  </div>
                </>
              )
            })()}
          </div>
        )}

        <ScenariosModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          title={title}
          scenarios={scenarios}
          currentScenarioId={currentScenarioId}
          onSave={handleSave}
        />
      </div>
    </NodeViewWrapper>
  )
}

export default ScenariosExtension
