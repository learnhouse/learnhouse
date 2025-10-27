import { NodeViewContent, NodeViewWrapper } from '@tiptap/react'
import React, { useState, useRef, useEffect } from 'react'
import { Edit, Plus, Trash2, Settings, Play, RotateCcw, ArrowRight, CheckCircle, GitBranch, RefreshCcw } from 'lucide-react'
import { twMerge } from 'tailwind-merge'
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
      <div className="rounded-xl px-3 sm:px-5 py-2 bg-slate-100 transition-all ease-linear">
        {/* Header section */}
        <div className="flex flex-wrap gap-2 pt-1 items-center text-sm">
          <div className="flex space-x-2 items-center text-sm">
            <GitBranch className="text-slate-400" size={15} />
            <p className="uppercase tracking-widest text-xs font-bold py-1 text-slate-400">
              Interactive Scenario
            </p>
          </div>
          
          {/* Completion message */}
          {scenarioComplete && !isEditable && (
            <div className="text-xs font-medium px-2 py-1 rounded-md bg-lime-100 text-lime-700">
              Scenario Complete!
            </div>
          )}
          
          <div className="grow"></div>
          
          {/* Action buttons */}
          {isEditable ? (
            <div>
              <button
                onClick={() => setIsModalOpen(true)}
                className="bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold py-1 px-2 rounded-lg text-xs"
              >
                Edit Scenarios
              </button>
            </div>
          ) : (
            <div className="flex space-x-1 items-center">
              <div
                onClick={resetScenario}
                className="cursor-pointer p-1.5 rounded-md hover:bg-slate-200"
                title="Reset scenario"
              >
                <RefreshCcw className="text-slate-500" size={15} />
              </div>
            </div>
          )}
        </div>

        {/* Scenario content */}
        {isEditable ? (
          <div className="pt-3 space-y-2">
            <div className="scenario-editor">
              <div className="flex space-x-2 items-center">
                <div className="grow">
                  <input
                    value={title}
                    placeholder="Scenario Title"
                    onChange={(e) => {
                      setTitle(e.target.value)
                      props.updateAttributes({ title: e.target.value })
                    }}
                    className="text-slate-800 bg-[#00008b00] border-2 border-gray-200 rounded-md border-dotted text-md font-bold w-full p-2"
                  />
                </div>
              </div>
              
              <div className="mt-3 p-3 bg-white rounded-lg border-2 border-dotted border-gray-200">
                <p className="text-slate-600 text-sm text-center">
                  {scenarios.length}/40 scenarios configured
                </p>
                <p className="text-slate-500 text-xs text-center mt-1">
                  Click "Edit Scenarios" to configure your interactive branching story
                </p>
              </div>
            </div>
          </div>
        ) : scenarioComplete ? (
          <div className="pt-3 space-y-2">
            <div className="text-center py-8 max-w-md mx-auto">
              <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <CheckCircle size={24} className="text-emerald-600" />
              </div>
              <h4 className="text-xl font-bold text-slate-900 mb-2">Scenario Complete!</h4>
              <p className="text-slate-600 mb-6 leading-relaxed">
                You've successfully navigated through this interactive scenario.
              </p>
              <button
                onClick={resetScenario}
                className="flex items-center gap-2 px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg transition-all font-medium text-sm shadow-sm hover:shadow-md mx-auto"
              >
                <RotateCcw size={16} />
                Start Over
              </button>
            </div>
          </div>
        ) : (
          <div className="pt-3 space-y-2">
            {(() => {
              const currentScenario = getCurrentScenario()
              if (!currentScenario) {
                return (
                  <div className="text-center py-8 max-w-md mx-auto">
                    <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-3">
                      <GitBranch size={20} className="text-slate-400" />
                    </div>
                    <h3 className="text-base font-medium text-slate-900 mb-2">Scenario Not Found</h3>
                    <p className="text-slate-500 text-sm">Please check your scenario configuration and try again.</p>
                  </div>
                )
              }

              return (
                <div className="w-full max-w-xl mx-auto space-y-4 p-4">
                  {/* Scenario Text */}
                  <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
                    {currentScenario.imageUrl && (
                      <div className="mb-4">
                        <img 
                          src={currentScenario.imageUrl} 
                          alt="Scenario illustration"
                          className="w-full h-48 object-cover rounded-lg border border-slate-200"
                          onError={(e) => {
                            e.currentTarget.style.display = 'none'
                          }}
                        />
                      </div>
                    )}
                    <p className="text-base text-slate-800 leading-relaxed font-medium">
                      {currentScenario.text}
                    </p>
                  </div>
                  
                  {/* Response Options */}
                  <div className="space-y-2">
                    {currentScenario.options.map((option, index) => (
                      <button
                        key={option.id}
                        onClick={() => handleOptionClick(option.nextScenarioId)}
                        className="w-full bg-white border border-slate-200 hover:border-blue-300 hover:bg-blue-50 rounded-lg p-3 transition-all group text-left shadow-sm hover:shadow-md"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-6 h-6 bg-slate-100 group-hover:bg-blue-100 rounded flex items-center justify-center flex-shrink-0 transition-colors">
                            <span className="text-sm font-bold text-slate-600 group-hover:text-blue-600">
                              {getOptionLetter(index)}
                            </span>
                          </div>
                          <div className="flex-1 text-slate-800 font-medium group-hover:text-blue-900 transition-colors">
                            {option.text}
                          </div>
                          <ArrowRight size={16} className="text-slate-400 group-hover:text-blue-500 group-hover:translate-x-1 transition-all" />
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
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
