import { NodeViewWrapper } from '@tiptap/react'
import React, { useState, useRef, useEffect } from 'react'
import { RotateCw, Edit, AlignLeft, AlignCenter, AlignRight, Palette, Maximize2, Minimize2, Square } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useEditorProvider } from '@components/Contexts/Editor/EditorContext'
import { useTranslation } from 'react-i18next'

const FlipcardExtension: React.FC = (props: any) => {
  const { t } = useTranslation()
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
      case 'left': return 'justify-start';
      case 'center': return 'justify-center';
      case 'right': return 'justify-end';
      default: return 'justify-center';
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
      green: isBack ? 'bg-emerald-600 border-emerald-700' : 'bg-emerald-500 border-emerald-600',
      yellow: isBack ? 'bg-amber-600 border-amber-700' : 'bg-amber-500 border-amber-600',
      red: isBack ? 'bg-red-600 border-red-700' : 'bg-red-500 border-red-600',
      purple: isBack ? 'bg-purple-600 border-purple-700' : 'bg-purple-500 border-purple-600',
      teal: isBack ? 'bg-teal-600 border-teal-700' : 'bg-teal-500 border-teal-600',
      amber: isBack ? 'bg-orange-600 border-orange-700' : 'bg-orange-500 border-orange-600',
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
    <NodeViewWrapper className={cn("flipcard-wrapper flex my-4", getAlignmentClass())}>
      <div className={cn("flipcard-container relative", getSizeClass())}>
        <div
          className={cn("flipcard-inner cursor-pointer", isFlipped && "flipped")}
          onClick={handleFlip}
        >
          {/* Front Side (Question) */}
          <div
            className={cn(
              "flipcard-front border-2 text-white p-6 nice-shadow flex flex-col items-center justify-center text-center rounded-xl",
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
                  placeholder={t('activities.enter_question')}
                />
              ) : (
                <div className={cn("text-center font-medium leading-relaxed flex items-center justify-center select-none", getFontSizeClass())}>
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
              <div className="text-xs opacity-70 mt-3 select-none pointer-events-none">{t('activities.click_to_flip')}</div>
            )}
          </div>

          {/* Back Side (Answer) */}
          <div
            className={cn(
              "flipcard-back border-2 text-white p-6 nice-shadow flex flex-col items-center justify-center text-center rounded-xl",
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
                  placeholder={t('activities.enter_answer')}
                />
              ) : (
                <div className={cn("text-center font-medium leading-relaxed flex items-center justify-center select-none", getFontSizeClass())}>
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
              <div className="text-xs opacity-70 mt-3">{t('activities.click_to_flip_back')}</div>
            )}
          </div>
        </div>

        {/* Editor Controls */}
        {isEditable && (
          <div className="flex mt-3 gap-1 justify-center opacity-60 hover:opacity-100 transition-opacity">
            {/* Alignment Controls */}
            <button
              onClick={(e) => {
                e.stopPropagation()
                handleAlignmentChange('left')
              }}
              className={cn(
                "p-1.5 rounded-md transition-colors text-xs",
                alignment === 'left' ? 'bg-neutral-700 text-white' : 'bg-neutral-200 hover:bg-neutral-300 text-neutral-600'
              )}
              title={t('activities.align_left')}
            >
              <AlignLeft size={12} />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation()
                handleAlignmentChange('center')
              }}
              className={cn(
                "p-1.5 rounded-md transition-colors text-xs",
                alignment === 'center' ? 'bg-neutral-700 text-white' : 'bg-neutral-200 hover:bg-neutral-300 text-neutral-600'
              )}
              title={t('activities.align_center')}
            >
              <AlignCenter size={12} />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation()
                handleAlignmentChange('right')
              }}
              className={cn(
                "p-1.5 rounded-md transition-colors text-xs",
                alignment === 'right' ? 'bg-neutral-700 text-white' : 'bg-neutral-200 hover:bg-neutral-300 text-neutral-600'
              )}
              title={t('activities.align_right')}
            >
              <AlignRight size={12} />
            </button>

            <div className="w-px h-4 bg-neutral-300 self-center mx-1"></div>

            {/* Size Controls */}
            <button
              onClick={(e) => {
                e.stopPropagation()
                handleSizeChange('small')
              }}
              className={cn(
                "p-1.5 rounded-md transition-colors text-xs",
                size === 'small' ? 'bg-neutral-700 text-white' : 'bg-neutral-200 hover:bg-neutral-300 text-neutral-600'
              )}
              title={t('activities.size_small')}
            >
              <Minimize2 size={12} />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation()
                handleSizeChange('medium')
              }}
              className={cn(
                "p-1.5 rounded-md transition-colors text-xs",
                size === 'medium' ? 'bg-neutral-700 text-white' : 'bg-neutral-200 hover:bg-neutral-300 text-neutral-600'
              )}
              title={t('activities.size_medium')}
            >
              <Square size={12} />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation()
                handleSizeChange('large')
              }}
              className={cn(
                "p-1.5 rounded-md transition-colors text-xs",
                size === 'large' ? 'bg-neutral-700 text-white' : 'bg-neutral-200 hover:bg-neutral-300 text-neutral-600'
              )}
              title={t('activities.size_large')}
            >
              <Maximize2 size={12} />
            </button>

            <div className="w-px h-4 bg-neutral-300 self-center mx-1"></div>

            {/* Color & Flip */}
            <button
              onClick={(e) => {
                e.stopPropagation()
                setShowColorPicker(!showColorPicker)
              }}
              className="p-1.5 bg-neutral-200 hover:bg-neutral-300 text-neutral-600 rounded-md transition-colors text-xs"
              title={t('activities.change_color')}
            >
              <Palette size={12} />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation()
                setIsFlipped(!isFlipped)
              }}
              className="p-1.5 bg-neutral-200 hover:bg-neutral-300 text-neutral-600 rounded-md transition-colors text-xs"
              title={t('activities.preview_flip')}
            >
              <RotateCw size={12} />
            </button>
          </div>
        )}

        {/* Color Picker */}
        {isEditable && showColorPicker && (
          <div ref={colorPickerRef} className="absolute top-full mt-2 left-1/2 transform -translate-x-1/2 p-3 bg-white rounded-lg nice-shadow z-10 border border-neutral-200">
            <div className="flex flex-wrap gap-2 max-w-xs">
              {colors.map((c) => (
                <button
                  key={c}
                  className={cn(
                    "w-8 h-8 rounded-full border-2 border-white hover:scale-110 transform transition-transform",
                    getCardColor(c),
                    color === c && "ring-2 ring-offset-2 ring-slate-400"
                  )}
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
