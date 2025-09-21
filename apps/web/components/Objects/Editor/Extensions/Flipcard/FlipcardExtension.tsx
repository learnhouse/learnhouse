import { NodeViewContent, NodeViewWrapper } from '@tiptap/react'
import React, { useState, useRef, useEffect } from 'react'
import { RotateCw, Edit, AlignLeft, AlignCenter, AlignRight, Palette, Maximize2, Minimize2, Square } from 'lucide-react'
import { twMerge } from 'tailwind-merge'
import { useEditorProvider } from '@components/Contexts/Editor/EditorContext'

const FlipcardExtension: React.FC = (props: any) => {
  const [isFlipped, setIsFlipped] = useState(false)
  const [question, setQuestion] = useState(props.node.attrs.question)
  const [answer, setAnswer] = useState(props.node.attrs.answer)
  const [color, setColor] = useState(props.node.attrs.color || 'blue')
  const [alignment, setAlignment] = useState(props.node.attrs.alignment || 'center')
  const [size, setSize] = useState(props.node.attrs.size || 'medium')
  const [showColorPicker, setShowColorPicker] = useState(false)
  const [isEditingQuestion, setIsEditingQuestion] = useState(false)
  const [isEditingAnswer, setIsEditingAnswer] = useState(false)
  const colorPickerRef = useRef<HTMLDivElement>(null)
  const questionInputRef = useRef<HTMLTextAreaElement>(null)
  const answerInputRef = useRef<HTMLTextAreaElement>(null)
  const editorState = useEditorProvider() as any
  const isEditable = editorState.isEditable

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (colorPickerRef.current && !colorPickerRef.current.contains(event.target as Node)) {
        setShowColorPicker(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [])

  const handleFlip = () => {
    // Allow flipping in both edit and view modes, but prevent when editing text
    if (!isEditingQuestion && !isEditingAnswer) {
      setIsFlipped(!isFlipped)
    }
  }

  const handleQuestionChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setQuestion(e.target.value)
    props.updateAttributes({
      question: e.target.value,
    })
  }

  const handleAnswerChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setAnswer(e.target.value)
    props.updateAttributes({
      answer: e.target.value,
    })
  }

  const handleAlignmentChange = (newAlignment: 'left' | 'center' | 'right') => {
    setAlignment(newAlignment)
    props.updateAttributes({
      alignment: newAlignment,
    })
  }

  const handleColorSelect = (selectedColor: string) => {
    setColor(selectedColor)
    setShowColorPicker(false)
    props.updateAttributes({
      color: selectedColor,
    })
  }

  const handleSizeChange = (newSize: 'small' | 'medium' | 'large') => {
    setSize(newSize)
    props.updateAttributes({
      size: newSize,
    })
  }

  const getAlignmentClass = () => {
    switch (alignment) {
      case 'left': return 'text-left justify-start';
      case 'center': return 'text-center justify-center';
      case 'right': return 'text-right justify-end';
      default: return 'text-center justify-center';
    }
  }

  const getSizeClass = () => {
    switch (size) {
      case 'small': return 'w-64 h-36';
      case 'medium': return 'w-80 h-48';
      case 'large': return 'w-96 h-60';
      default: return 'w-80 h-48';
    }
  }

  const getFontSizeClass = () => {
    switch (size) {
      case 'small': return 'text-sm';
      case 'medium': return 'text-lg';
      case 'large': return 'text-xl';
      default: return 'text-lg';
    }
  }

  const getIconSizeClass = () => {
    switch (size) {
      case 'small': return 16;
      case 'medium': return 20;
      case 'large': return 24;
      default: return 20;
    }
  }

  const getCardColor = (color: string, isBack: boolean = false) => {
    const baseColors = {
      sky: isBack ? 'bg-sky-600 border-sky-700' : 'bg-sky-500 border-sky-600',
      green: isBack ? 'bg-green-600 border-green-700' : 'bg-green-500 border-green-600',
      yellow: isBack ? 'bg-yellow-600 border-yellow-700' : 'bg-yellow-500 border-yellow-600',
      red: isBack ? 'bg-red-600 border-red-700' : 'bg-red-500 border-red-600',
      purple: isBack ? 'bg-purple-600 border-purple-700' : 'bg-purple-500 border-purple-600',
      teal: isBack ? 'bg-teal-600 border-teal-700' : 'bg-teal-500 border-teal-600',
      amber: isBack ? 'bg-amber-600 border-amber-700' : 'bg-amber-500 border-amber-600',
      indigo: isBack ? 'bg-indigo-600 border-indigo-700' : 'bg-indigo-500 border-indigo-600',
      neutral: isBack ? 'bg-neutral-700 border-neutral-800' : 'bg-neutral-600 border-neutral-700',
      blue: isBack ? 'bg-blue-600 border-blue-700' : 'bg-blue-500 border-blue-600',
    }
    return baseColors[color as keyof typeof baseColors] || baseColors.blue
  }

  const colors = ['sky', 'green', 'yellow', 'red', 'purple', 'teal', 'amber', 'indigo', 'neutral', 'blue']

  const handleQuestionEdit = () => {
    setIsEditingQuestion(true)
    setTimeout(() => questionInputRef.current?.focus(), 0)
  }

  const handleAnswerEdit = () => {
    setIsEditingAnswer(true)
    setTimeout(() => answerInputRef.current?.focus(), 0)
  }

  const handleQuestionBlur = () => {
    setIsEditingQuestion(false)
  }

  const handleAnswerBlur = () => {
    setIsEditingAnswer(false)
  }

  return (
    <NodeViewWrapper className={`flipcard-wrapper flex ${getAlignmentClass()} my-4`}>
      <div className={`flipcard-container ${getSizeClass()} relative`}>
        <div 
          className={`flipcard-inner cursor-pointer ${
            isFlipped ? 'flipped' : ''
          }`}
          onClick={handleFlip}
        >
          {/* Front Side (Question) */}
          <div 
            className={twMerge(
              'flipcard-front border-2 text-white p-6 nice-shadow flex flex-col items-center justify-center text-center',
              getCardColor(color, false)
            )}
          >
            <div className="flex items-center justify-center mb-3 select-none pointer-events-none">
              <RotateCw size={getIconSizeClass()} className="opacity-70" />
            </div>
            <div className="flex-1 flex items-center justify-center">
              {isEditable && isEditingQuestion ? (
                <textarea
                  ref={questionInputRef}
                  value={question}
                  onChange={handleQuestionChange}
                  onBlur={handleQuestionBlur}
                  className="bg-white/20 backdrop-blur-sm text-white placeholder-white/70 p-2 rounded-lg w-full h-20 resize-none border-none outline-none text-center"
                  placeholder="Enter your question..."
                />
              ) : (
                <div className={`text-center font-medium ${getFontSizeClass()} leading-relaxed flex items-center justify-center select-none`}>
                  <span className="select-none pointer-events-none">{question}</span>
                  {isEditable && (
                    <button 
                      onClick={(e) => {
                        e.stopPropagation()
                        handleQuestionEdit()
                      }}
                      className="ml-2 opacity-60 hover:opacity-100 flex-shrink-0 pointer-events-auto"
                    >
                      <Edit size={14} />
                    </button>
                  )}
                </div>
              )}
            </div>
            {!isEditingQuestion && (
              <div className="text-xs opacity-70 mt-3 select-none pointer-events-none">Click to flip</div>
            )}
          </div>

          {/* Back Side (Answer) */}
          <div 
            className={twMerge(
              'flipcard-back border-2 text-white p-6 nice-shadow flex flex-col items-center justify-center text-center',
              getCardColor(color, true)
            )}
          >
            <div className="flex items-center justify-center mb-3 select-none pointer-events-none">
              <RotateCw size={getIconSizeClass()} className="opacity-70 rotate-180" />
            </div>
            <div className="flex-1 flex items-center justify-center">
              {isEditable && isEditingAnswer ? (
                <textarea
                  ref={answerInputRef}
                  value={answer}
                  onChange={handleAnswerChange}
                  onBlur={handleAnswerBlur}
                  className="bg-white/20 backdrop-blur-sm text-white placeholder-white/70 p-2 rounded-lg w-full h-20 resize-none border-none outline-none text-center"
                  placeholder="Enter your answer..."
                />
              ) : (
                <div className={`text-center font-medium ${getFontSizeClass()} leading-relaxed flex items-center justify-center select-none`}>
                  <span className="select-none pointer-events-none">{answer}</span>
                  {isEditable && (
                    <button 
                      onClick={(e) => {
                        e.stopPropagation()
                        handleAnswerEdit()
                      }}
                      className="ml-2 opacity-60 hover:opacity-100 flex-shrink-0 pointer-events-auto"
                    >
                      <Edit size={14} />
                    </button>
                  )}
                </div>
              )}
            </div>
            {!isEditingAnswer && (
              <div className="text-xs opacity-70 mt-3">Click to flip back</div>
            )}
          </div>
        </div>

        {/* Editor Controls */}
        {isEditable && (
          <div className="flex mt-3 space-x-1 justify-center opacity-60 hover:opacity-100 transition-opacity">
            <button 
              onClick={(e) => {
                e.stopPropagation()
                handleAlignmentChange('left')
              }} 
              className={`p-1.5 rounded-md transition-colors text-xs ${alignment === 'left' ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 hover:bg-gray-200 text-gray-600'}`}
              title="Align Left"
            >
              <AlignLeft size={12} />
            </button>
            <button 
              onClick={(e) => {
                e.stopPropagation()
                handleAlignmentChange('center')
              }} 
              className={`p-1.5 rounded-md transition-colors text-xs ${alignment === 'center' ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 hover:bg-gray-200 text-gray-600'}`}
              title="Align Center"
            >
              <AlignCenter size={12} />
            </button>
            <button 
              onClick={(e) => {
                e.stopPropagation()
                handleAlignmentChange('right')
              }} 
              className={`p-1.5 rounded-md transition-colors text-xs ${alignment === 'right' ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 hover:bg-gray-200 text-gray-600'}`}
              title="Align Right"
            >
              <AlignRight size={12} />
            </button>
            
            {/* Size Controls */}
            <div className="w-px h-4 bg-gray-300 self-center mx-1"></div>
            
            <button 
              onClick={(e) => {
                e.stopPropagation()
                handleSizeChange('small')
              }} 
              className={`p-1.5 rounded-md transition-colors text-xs ${size === 'small' ? 'bg-green-100 text-green-600' : 'bg-gray-100 hover:bg-gray-200 text-gray-600'}`}
              title="Small Size"
            >
              <Minimize2 size={12} />
            </button>
            <button 
              onClick={(e) => {
                e.stopPropagation()
                handleSizeChange('medium')
              }} 
              className={`p-1.5 rounded-md transition-colors text-xs ${size === 'medium' ? 'bg-green-100 text-green-600' : 'bg-gray-100 hover:bg-gray-200 text-gray-600'}`}
              title="Medium Size"
            >
              <Square size={12} />
            </button>
            <button 
              onClick={(e) => {
                e.stopPropagation()
                handleSizeChange('large')
              }} 
              className={`p-1.5 rounded-md transition-colors text-xs ${size === 'large' ? 'bg-green-100 text-green-600' : 'bg-gray-100 hover:bg-gray-200 text-gray-600'}`}
              title="Large Size"
            >
              <Maximize2 size={12} />
            </button>
            
            <div className="w-px h-4 bg-gray-300 self-center mx-1"></div>
            
            <button 
              onClick={(e) => {
                e.stopPropagation()
                setShowColorPicker(!showColorPicker)
              }} 
              className="p-1.5 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-md transition-colors text-xs"
              title="Change Color"
            >
              <Palette size={12} />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation()
                setIsFlipped(!isFlipped)
              }}
              className="p-1.5 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-md transition-colors text-xs"
              title="Preview Flip"
            >
              <RotateCw size={12} />
            </button>
          </div>
        )}

        {/* Color Picker */}
        {isEditable && showColorPicker && (
          <div ref={colorPickerRef} className="absolute top-full mt-2 left-1/2 transform -translate-x-1/2 p-3 bg-white rounded-lg nice-shadow z-10">
            <div className="flex flex-wrap gap-2 max-w-xs">
              {colors.map((c) => (
                <button
                  key={c}
                  className={`w-8 h-8 rounded-full border-2 border-white hover:scale-110 transform transition-transform ${getCardColor(c)} ${color === c ? 'ring-2 ring-offset-2 ring-gray-400' : ''}`}
                  onClick={() => handleColorSelect(c)}
                  title={c.charAt(0).toUpperCase() + c.slice(1)}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </NodeViewWrapper>
  )
}

export default FlipcardExtension
