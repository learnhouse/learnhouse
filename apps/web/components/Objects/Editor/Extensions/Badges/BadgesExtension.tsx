import { NodeViewContent, NodeViewWrapper } from '@tiptap/react'
import React, { useState, useRef, useEffect } from 'react'
import Picker from '@emoji-mart/react'
import { ArrowRight, ChevronDown, ChevronRight, EllipsisVertical, Palette, Plus } from 'lucide-react'
import { twMerge } from 'tailwind-merge'
import { useEditorProvider } from '@components/Contexts/Editor/EditorContext'

const BadgesExtension: React.FC = (props: any) => {
  const [color, setColor] = useState(props.node.attrs.color)
  const [emoji, setEmoji] = useState(props.node.attrs.emoji)
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const [showColorPicker, setShowColorPicker] = useState(false)
  const [showPredefinedCallouts, setShowPredefinedCallouts] = useState(false)
  const pickerRef = useRef<HTMLDivElement>(null)
  const colorPickerRef = useRef<HTMLDivElement>(null)
  const editorState = useEditorProvider() as any
  const isEditable = editorState.isEditable

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        (pickerRef.current && !pickerRef.current.contains(event.target as Node)) ||
        (colorPickerRef.current && !colorPickerRef.current.contains(event.target as Node))
      ) {
        setShowEmojiPicker(false)
        setShowColorPicker(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [])

  const handleEmojiSelect = (emoji: any) => {
    setEmoji(emoji.native)
    setShowEmojiPicker(false)
    props.updateAttributes({
      emoji: emoji.native,
    })
  }

  const handleColorSelect = (selectedColor: string) => {
    setColor(selectedColor)
    setShowColorPicker(false)
    props.updateAttributes({
      color: selectedColor,
    })
  }

  const handlePredefinedBadgeSelect = (badge: typeof predefinedBadges[0]) => {
    setEmoji(badge.emoji)
    setColor(badge.color)

    props.updateAttributes({
      emoji: badge.emoji,
      color: badge.color,
    })

    // Insert the predefined content
    const { editor } = props
    if (editor) {
      editor.commands.setTextSelection({ from: props.getPos() + 1, to: props.getPos() + props.node.nodeSize - 1 })
      editor.commands.insertContent(badge.content)
    }

    setShowPredefinedCallouts(false)
  }

  const colors = ['sky', 'green', 'yellow', 'red', 'purple', 'teal', 'amber', 'indigo', 'neutral']
  const predefinedBadges = [
    {
      emoji: '📝',
      color: 'sky',
      content: 'Key Concept'
    },
    {
      emoji: '💡',
      color: 'yellow',
      content: 'Example'
    },
    {
      emoji: '🔍',
      color: 'teal',
      content: 'Deep Dive'
    },
    {
      emoji: '⚠️',
      color: 'red',
      content: 'Important Note'
    },
    {
      emoji: '🧠',
      color: 'purple',
      content: 'Remember This'
    },
    {
      emoji: '🏋️',
      color: 'green',
      content: 'Exercise'
    },
    {
      emoji: '🎯',
      color: 'amber',
      content: 'Learning Objective'
    },
    {
      emoji: '📚',
      color: 'indigo',
      content: 'Further Reading'
    },
    {
      emoji: '💬',
      color: 'neutral',
      content: 'Discussion Topic'
    }
  ]

  const getBadgeColor = (color: string) => {
    switch (color) {
      case 'sky': return 'bg-sky-400 text-sky-50';
      case 'green': return 'bg-green-400 text-green-50';
      case 'yellow': return 'bg-yellow-400 text-black';
      case 'red': return 'bg-red-500 text-red-50';
      case 'purple': return 'bg-purple-400 text-purple-50';
      case 'pink': return 'bg-pink-400 text-pink-50';
      case 'teal': return 'bg-teal-400 text-teal-900';
      case 'amber': return 'bg-amber-600 text-amber-100';
      case 'indigo': return 'bg-indigo-400 text-indigo-50';
      case 'neutral': return 'bg-neutral-800 text-white';
      default: return 'bg-sky-400 text-white';
    }
  }

  return (
    <NodeViewWrapper>
      <div className='flex space-x-2 items-center'>
        <div
          className={twMerge(
            'flex space-x-1 py-1.5 items-center w-fit rounded-full outline outline-2 outline-white/20 px-3.5 font-semibold nice-shadow text-sm my-2',
            getBadgeColor(color)
          )}
        >
          <div className="flex items-center justify-center space-x-1">
            <span className='text'>{emoji}</span>
            {isEditable && (
              <button onClick={() => setShowEmojiPicker(!showEmojiPicker)}>
                <ChevronDown size={14} />
              </button>
            )}
          </div>
          <NodeViewContent
            contentEditable={isEditable}
            className="content capitalize text tracking-wide "
          >
          </NodeViewContent>
          {isEditable && (
            <div className="flex items-center justify-center space-x-2 relative">
              <button onClick={() => setShowColorPicker(!showColorPicker)}>
                <Palette size={14} />
              </button>
              {showColorPicker && (
                <div ref={colorPickerRef} className="absolute left-full ml-2 p-2 bg-white rounded-full nice-shadow">
                  <div className="flex space-x-2">
                    {colors.map((c) => (
                      <button
                        key={c}
                        className={`w-8 h-8 rounded-full ${getBadgeColor(c)} hover:ring-2 hover:ring-opacity-50 focus:outline-none focus:ring-2 focus:ring-opacity-50`}
                        onClick={() => handleColorSelect(c)}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
        {isEditable && (
          <button
            onClick={() => setShowPredefinedCallouts(!showPredefinedCallouts)}
            className="text-neutral-300 hover:text-neutral-400 transition-colors"
          >
            <ChevronRight size={16} />
          </button>
        )}
        {isEditable && showPredefinedCallouts && (
          <div className='flex flex-wrap gap-2 absolute mt-8 bg-white/90 backdrop-blur-md p-2 rounded-lg nice-shadow'>
            {predefinedBadges.map((badge, index) => (
              <button
                key={index}
                onClick={() => handlePredefinedBadgeSelect(badge)}
                className={`flex text-xs items-center px-3 py-1 rounded-xl space-x-2 ${getBadgeColor(badge.color)} text-gray-600 font-bold light-shadow hover:opacity-80 transition-all duration-100 ease-linear`}
              >
                <span className='text-xs'>{badge.emoji}</span>
                <span className="content capitalize">{badge.content}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {isEditable && showEmojiPicker && (
        <div ref={pickerRef}>
          <Picker
            searchPosition="top"
            theme="light"
            previewPosition="none"
            maxFrequentRows={0}
            autoFocus={false}
            onEmojiSelect={handleEmojiSelect}
          />
        </div>
      )}


    </NodeViewWrapper>
  )
}

export default BadgesExtension;
