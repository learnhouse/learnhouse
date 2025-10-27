import React, { useState, useEffect } from 'react'
import { Plus, Trash2, Settings, Play, RotateCcw, ArrowRight, CheckCircle, Save, GitBranch, Image } from 'lucide-react'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import { ButtonBlack } from '@components/Objects/StyledElements/Form/Form'

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

interface ScenariosModalProps {
  isOpen: boolean
  onClose: () => void
  title: string
  scenarios: Scenario[]
  currentScenarioId: string
  onSave: (title: string, scenarios: Scenario[], currentScenarioId: string) => void
}

const ScenariosModal: React.FC<ScenariosModalProps> = ({
  isOpen,
  onClose,
  title: initialTitle,
  scenarios: initialScenarios,
  currentScenarioId: initialCurrentScenarioId,
  onSave
}) => {
  const [title, setTitle] = useState(initialTitle)
  const [scenarios, setScenarios] = useState<Scenario[]>(initialScenarios)
  const [currentScenarioId, setCurrentScenarioId] = useState(initialCurrentScenarioId)
  const [showPreview, setShowPreview] = useState(false)
  const [previewCurrentId, setPreviewCurrentId] = useState('1')
  const [showImageInputs, setShowImageInputs] = useState<Record<string, boolean>>({})

  useEffect(() => {
    setTitle(initialTitle)
    setScenarios(initialScenarios)
    setCurrentScenarioId(initialCurrentScenarioId)
    setPreviewCurrentId(initialCurrentScenarioId)
    setShowImageInputs({})
  }, [initialTitle, initialScenarios, initialCurrentScenarioId])

  const handleSave = () => {
    onSave(title, scenarios, currentScenarioId)
    onClose()
  }

  const handleClose = () => {
    setShowPreview(false)
    onClose()
  }

  const getPreviewScenario = (): Scenario | null => {
    return scenarios.find(s => s.id === previewCurrentId) || null
  }

  const handleOptionClick = (nextScenarioId: string | null) => {
    if (nextScenarioId) {
      setPreviewCurrentId(nextScenarioId)
    } else {
      setPreviewCurrentId('end')
    }
  }

  const addNewScenario = () => {
    if (scenarios.length >= 40) {
      alert('Maximum of 40 scenarios allowed')
      return
    }

    const newId = (Math.max(...scenarios.map(s => parseInt(s.id))) + 1).toString()
    const newScenario: Scenario = {
      id: newId,
      text: 'New scenario text...',
      imageUrl: '',
      options: [
        { id: `opt${Date.now()}`, text: 'Option 1', nextScenarioId: null },
        { id: `opt${Date.now() + 1}`, text: 'Option 2', nextScenarioId: null }
      ]
    }
    setScenarios([...scenarios, newScenario])
  }

  const deleteScenario = (scenarioId: string) => {
    if (scenarios.length <= 1) {
      alert('At least one scenario is required')
      return
    }
    
    const updatedScenarios = scenarios.filter(s => s.id !== scenarioId)
    setScenarios(updatedScenarios)
    
    // Update references to deleted scenario
    const cleanedScenarios = updatedScenarios.map(scenario => ({
      ...scenario,
      options: scenario.options.map(option => ({
        ...option,
        nextScenarioId: option.nextScenarioId === scenarioId ? null : option.nextScenarioId
      }))
    }))
    setScenarios(cleanedScenarios)
    
    if (currentScenarioId === scenarioId) {
      setCurrentScenarioId(updatedScenarios[0]?.id || '1')
    }
  }

  const updateScenario = (scenarioId: string, updates: Partial<Scenario>) => {
    setScenarios(scenarios.map(s => 
      s.id === scenarioId ? { ...s, ...updates } : s
    ))
  }

  const addOption = (scenarioId: string) => {
    const scenario = scenarios.find(s => s.id === scenarioId)
    if (!scenario || scenario.options.length >= 4) {
      alert('Maximum of 4 options per scenario')
      return
    }

    const newOption: ScenarioOption = {
      id: `opt${Date.now()}`,
      text: 'New option',
      nextScenarioId: null
    }

    updateScenario(scenarioId, {
      options: [...scenario.options, newOption]
    })
  }

  const deleteOption = (scenarioId: string, optionId: string) => {
    const scenario = scenarios.find(s => s.id === scenarioId)
    if (!scenario || scenario.options.length <= 1) {
      alert('At least one option is required per scenario')
      return
    }

    updateScenario(scenarioId, {
      options: scenario.options.filter(opt => opt.id !== optionId)
    })
  }

  const updateOption = (scenarioId: string, optionId: string, updates: Partial<ScenarioOption>) => {
    const scenario = scenarios.find(s => s.id === scenarioId)
    if (!scenario) return

    updateScenario(scenarioId, {
      options: scenario.options.map(opt => 
        opt.id === optionId ? { ...opt, ...updates } : opt
      )
    })
  }

  const resetPreview = () => {
    setPreviewCurrentId(currentScenarioId)
  }

  const toggleImageInput = (scenarioId: string) => {
    setShowImageInputs(prev => ({
      ...prev,
      [scenarioId]: !prev[scenarioId]
    }))
  }

  const renderPreviewContent = () => {
    const previewScenario = getPreviewScenario()
    
    return (
      <div className="flex flex-col h-[calc(75vh-220px)] p-2">
        {/* Preview Header */}
        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 p-4 -mx-2 -mt-2 mb-4 flex-shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
                <Play size={16} className="text-blue-600" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-900">{title}</h3>
                <p className="text-sm text-slate-600">Interactive Preview</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={resetPreview}
                className="flex items-center gap-2 px-3 py-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 rounded-lg transition-all text-sm font-medium shadow-sm"
              >
                <RotateCcw size={14} />
                Reset
              </button>
              <button
                onClick={() => setShowPreview(false)}
                className="flex items-center gap-2 px-3 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg transition-all text-sm font-medium shadow-sm"
              >
                <Settings size={14} />
                Back to Edit
              </button>
            </div>
          </div>
        </div>

        {/* Preview Content */}
        <div className="flex-1 flex items-center justify-center overflow-y-auto">
          {previewCurrentId === 'end' ? (
            <div className="text-center py-8 max-w-md mx-auto">
              <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <CheckCircle size={24} className="text-emerald-600" />
              </div>
              <h4 className="text-xl font-bold text-slate-900 mb-2">Scenario Complete!</h4>
              <p className="text-slate-600 mb-6 leading-relaxed">
                You've successfully navigated through this interactive scenario.
              </p>
              <button
                onClick={resetPreview}
                className="flex items-center gap-2 px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg transition-all font-medium text-sm shadow-sm hover:shadow-md mx-auto"
              >
                <RotateCcw size={16} />
                Start Over
              </button>
            </div>
          ) : previewScenario ? (
            <div className="w-full max-w-xl mx-auto space-y-4 p-4">
              {/* Scenario Text */}
              <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
                {previewScenario.imageUrl && (
                  <div className="mb-4">
                    <img 
                      src={previewScenario.imageUrl} 
                      alt="Scenario illustration"
                      className="w-full h-48 object-cover rounded-lg border border-slate-200"
                      onError={(e) => {
                        e.currentTarget.style.display = 'none'
                      }}
                    />
                  </div>
                )}
                <p className="text-base text-slate-800 leading-relaxed font-medium">
                  {previewScenario.text}
                </p>
              </div>
              
              {/* Response Options */}
              <div className="space-y-2">
                {previewScenario.options.map((option, index) => (
                  <button
                    key={option.id}
                    onClick={() => handleOptionClick(option.nextScenarioId)}
                    className="w-full bg-white border border-slate-200 hover:border-blue-300 hover:bg-blue-50 rounded-lg p-3 transition-all group text-left shadow-sm hover:shadow-md"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-6 h-6 bg-slate-100 group-hover:bg-blue-100 rounded flex items-center justify-center flex-shrink-0 transition-colors">
                        <span className="text-sm font-bold text-slate-600 group-hover:text-blue-600">
                          {String.fromCharCode('A'.charCodeAt(0) + index)}
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
          ) : (
            <div className="text-center py-8 max-w-md mx-auto">
              <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-3">
                <GitBranch size={20} className="text-slate-400" />
              </div>
              <h3 className="text-base font-medium text-slate-900 mb-2">Scenario Not Found</h3>
              <p className="text-slate-500 text-sm">Please check your scenario configuration and try again.</p>
            </div>
          )}
        </div>
      </div>
    )
  }

  const renderEditContent = () => (
    <div className="flex flex-col h-[calc(75vh-220px)] p-2">
      {/* Header Section */}
      <div className="bg-white border-b border-slate-200 p-4 -mx-2 -mt-2 mb-4 flex-shrink-0">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
          <div className="flex-1 min-w-0">
            <label className="block text-sm font-semibold text-slate-900 mb-2">
              Scenario Title
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-2.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-slate-900 placeholder-slate-400 transition-all"
              placeholder="Enter your scenario title..."
            />
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 px-2 py-1.5 bg-slate-100 rounded-lg">
              <div className="w-2 h-2 bg-slate-400 rounded-full"></div>
              <span className="text-xs font-medium text-slate-600">
                {scenarios.length}/40
              </span>
            </div>
            <button
              onClick={() => setShowPreview(true)}
              className="flex items-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-all font-medium text-sm shadow-sm hover:shadow-md"
            >
              <Play size={14} />
              Preview
            </button>
            <button
              onClick={addNewScenario}
              disabled={scenarios.length >= 40}
              className="flex items-center gap-2 px-3 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg transition-all font-medium text-sm shadow-sm hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-slate-900"
            >
              <Plus size={14} />
              Add
            </button>
          </div>
        </div>
      </div>

      {/* Scenarios List */}
      <div className="flex-1 overflow-hidden min-h-0">
        <div className="h-full overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-transparent hover:scrollbar-thumb-gray-400">
          <div className="space-y-4 pb-4">
            {scenarios.map((scenario, scenarioIndex) => (
              <div key={scenario.id} className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-shadow">
                {/* Scenario Header */}
                <div className="bg-gradient-to-r from-slate-50 to-slate-100 px-4 py-3 border-b border-slate-200">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-7 h-7 bg-slate-200 rounded-lg flex items-center justify-center">
                        <span className="text-sm font-bold text-slate-700">{scenarioIndex + 1}</span>
                      </div>
                      <div>
                        <h3 className="text-base font-semibold text-slate-900">Scenario {scenario.id}</h3>
                        {scenario.id === currentScenarioId && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-100 text-emerald-700 text-xs font-medium rounded-full mt-1">
                            <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full"></div>
                            Starting Point
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setCurrentScenarioId(scenario.id)}
                        className={`px-2 py-1 rounded-md transition-all text-xs font-medium ${
                          scenario.id === currentScenarioId 
                            ? 'bg-emerald-500 text-white shadow-sm' 
                            : 'bg-slate-200 hover:bg-slate-300 text-slate-700'
                        }`}
                        title="Set as starting scenario"
                      >
                        {scenario.id === currentScenarioId ? 'Start' : 'Set Start'}
                      </button>
                      <button
                        onClick={() => deleteScenario(scenario.id)}
                        disabled={scenarios.length <= 1}
                        className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-md transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:text-slate-400 disabled:hover:bg-transparent"
                        title="Delete scenario"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Scenario Content */}
                <div className="p-4 space-y-4">
                  {/* Scenario Text */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-sm font-medium text-slate-700">
                        Scenario Description
                      </label>
                      <button
                        onClick={() => toggleImageInput(scenario.id)}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all text-xs font-medium border ${
                          showImageInputs[scenario.id] 
                            ? 'text-blue-700 bg-blue-50 border-blue-200 hover:bg-blue-100 shadow-sm' 
                            : scenario.imageUrl && scenario.imageUrl.trim() !== ''
                            ? 'text-blue-700 bg-blue-50 border-blue-200 hover:bg-blue-100'
                            : 'text-slate-600 bg-white border-slate-200 hover:text-blue-600 hover:bg-blue-50 hover:border-blue-200'
                        }`}
                        title={scenario.imageUrl && scenario.imageUrl.trim() !== '' ? "Edit image" : "Add image"}
                      >
                        <Image size={14} />
                        <span>
                          {scenario.imageUrl && scenario.imageUrl.trim() !== '' ? 'Image' : 'Add Image'}
                        </span>
                        {scenario.imageUrl && scenario.imageUrl.trim() !== '' && (
                          <span className="inline-flex items-center justify-center w-4 h-4 text-xs font-bold text-white bg-blue-600 rounded-full">
                            1
                          </span>
                        )}
                      </button>
                    </div>
                    <textarea
                      value={scenario.text}
                      onChange={(e) => updateScenario(scenario.id, { text: e.target.value })}
                      className="w-full p-3 border border-slate-300 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-slate-900 placeholder-slate-400 transition-all"
                      rows={2}
                      placeholder="Describe what happens in this scenario..."
                    />
                  </div>

                  {/* Scenario Image */}
                  {showImageInputs[scenario.id] && (
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">
                        Image URL
                      </label>
                      <input
                        type="url"
                        value={scenario.imageUrl || ''}
                        onChange={(e) => updateScenario(scenario.id, { imageUrl: e.target.value })}
                        className="w-full p-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-slate-900 placeholder-slate-400 transition-all"
                        placeholder="https://example.com/image.jpg"
                      />
                      {scenario.imageUrl && (
                        <div className="mt-2">
                          <img 
                            src={scenario.imageUrl} 
                            alt="Scenario preview"
                            className="w-full h-32 object-cover rounded-lg border border-slate-200"
                            onError={(e) => {
                              e.currentTarget.style.display = 'none'
                            }}
                          />
                        </div>
                      )}
                    </div>
                  )}

                  {/* Response Options */}
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <label className="text-sm font-medium text-slate-700">
                        Response Options ({scenario.options.length}/4)
                      </label>
                      <button
                        onClick={() => addOption(scenario.id)}
                        disabled={scenario.options.length >= 4}
                        className="flex items-center gap-1 px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md transition-all text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-slate-100"
                        title="Add response option"
                      >
                        <Plus size={12} />
                        Add
                      </button>
                    </div>
                    
                    <div className="space-y-2">
                      {scenario.options.map((option, index) => (
                        <div key={option.id} className="group bg-slate-50 border border-slate-200 rounded-lg p-3 hover:bg-slate-100 transition-all">
                          <div className="flex items-start gap-2">
                            <div className="w-6 h-6 bg-white border border-slate-300 rounded flex items-center justify-center flex-shrink-0 mt-0.5">
                              <span className="text-xs font-bold text-slate-600">
                                {String.fromCharCode('A'.charCodeAt(0) + index)}
                              </span>
                            </div>
                            <div className="flex-1 space-y-2">
                              <input
                                type="text"
                                value={option.text}
                                onChange={(e) => updateOption(scenario.id, option.id, { text: e.target.value })}
                                className="w-full px-2 py-2 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white placeholder-slate-400 transition-all"
                                placeholder="Enter response option..."
                              />
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-slate-500 font-medium">→</span>
                                <select
                                  value={option.nextScenarioId || ''}
                                  onChange={(e) => updateOption(scenario.id, option.id, { 
                                    nextScenarioId: e.target.value || null 
                                  })}
                                  className="flex-1 px-2 py-1.5 border border-slate-300 rounded text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white transition-all"
                                >
                                  <option value="">End scenario</option>
                                  {scenarios.map((s) => (
                                    <option key={s.id} value={s.id}>
                                      Scenario {s.id}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            </div>
                            <button
                              onClick={() => deleteOption(scenario.id, option.id)}
                              disabled={scenario.options.length <= 1}
                              className="p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded transition-all opacity-0 group-hover:opacity-100 disabled:opacity-0 disabled:cursor-not-allowed flex-shrink-0"
                              title="Delete option"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ))}
            
            {scenarios.length === 0 && (
              <div className="text-center py-8">
                <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-3">
                  <GitBranch size={20} className="text-slate-400" />
                </div>
                <h3 className="text-base font-medium text-slate-900 mb-2">No scenarios yet</h3>
                <p className="text-slate-500 text-sm mb-4">Create your first scenario to get started.</p>
                <button
                  onClick={addNewScenario}
                  className="flex items-center gap-2 px-3 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg transition-all font-medium text-sm shadow-sm hover:shadow-md mx-auto"
                >
                  <Plus size={14} />
                  Create First Scenario
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )

  return (
    <Modal
      isDialogOpen={isOpen}
      onOpenChange={handleClose}
      dialogTitle={showPreview ? "Scenario Preview" : "Edit Scenarios"}
      dialogDescription={showPreview ? "Test your interactive scenario" : "Create and manage your interactive scenarios"}
      customHeight="max-h-[75vh]"
      customWidth="!w-[70vw] !max-w-[70vw] !sm:w-[70vw] !sm:max-w-[70vw] !md:w-[70vw] !md:max-w-[70vw] !lg:max-w-[70vw] !xl:max-w-[70vw]"
      dialogContent={showPreview ? renderPreviewContent() : renderEditContent()}
      dialogClose={
        <>
          <ButtonBlack 
            onClick={handleClose}
            css={{ 
              backgroundColor: '$gray200', 
              color: '$gray700',
              '&:hover': { backgroundColor: '$gray300' }
            }}
          >
            Cancel
          </ButtonBlack>
          {!showPreview && (
            <ButtonBlack onClick={handleSave}>
              <div className="flex items-center gap-2">
                <Save size={16} />
                Save Changes
              </div>
            </ButtonBlack>
          )}
        </>
      }
    />
  )
}

export default ScenariosModal
