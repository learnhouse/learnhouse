import { useEditorProvider } from '@components/Contexts/Editor/EditorContext'
import Picker from '@emoji-mart/react'
import { NodeViewContent, NodeViewWrapper } from '@tiptap/react'
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowRight,
  ChevronDown,
  Link,
  Palette,
} from 'lucide-react'
import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { twMerge } from 'tailwind-merge'

const ButtonsExtension: React.FC = (props: any) => {
  const [emoji, setEmoji] = useState(props.node.attrs.emoji)
  const [link, setLink] = useState(props.node.attrs.link)
  const [alignment, setAlignment] = useState(props.node.attrs.alignment)
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const [showLinkInput, setShowLinkInput] = useState(false)
  const [color, setColor] = useState(props.node.attrs.color || 'blue')
  const [showColorPicker, setShowColorPicker] = useState(false)
  const pickerRef = useRef<HTMLDivElement>(null)
  const linkInputRef = useRef<HTMLInputElement>(null)
  const colorPickerRef = useRef<HTMLDivElement>(null)
  const editorState = useEditorProvider() as any
  const isEditable = editorState.isEditable

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        pickerRef.current &&
        !pickerRef.current.contains(event.target as Node)
      ) {
        setShowEmojiPicker(false)
      }
      if (
        linkInputRef.current &&
        !linkInputRef.current.contains(event.target as Node)
      ) {
        setShowLinkInput(false)
      }
      if (
        colorPickerRef.current &&
        !colorPickerRef.current.contains(event.target as Node)
      ) {
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

  const handleLinkChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setLink(e.target.value)
    props.updateAttributes({
      link: e.target.value,
    })
  }

  const handleAlignmentChange = (newAlignment: 'left' | 'center' | 'right') => {
    setAlignment(newAlignment)
    props.updateAttributes({
      alignment: newAlignment,
    })
  }

  const getAlignmentClass = () => {
    switch (alignment) {
      case 'left':
        return 'text-left'
      case 'center':
        return 'text-center'
      case 'right':
        return 'text-right'
      default:
        return 'text-left'
    }
  }

  const handleColorSelect = (selectedColor: string) => {
    setColor(selectedColor)
    setShowColorPicker(false)
    props.updateAttributes({
      color: selectedColor,
    })
  }

  const getButtonColor = (color: string) => {
    switch (color) {
      case 'sky':
        return 'bg-sky-500 hover:bg-sky-600'
      case 'green':
        return 'bg-green-500 hover:bg-green-600'
      case 'yellow':
        return 'bg-yellow-500 hover:bg-yellow-600'
      case 'red':
        return 'bg-red-500 hover:bg-red-600'
      case 'purple':
        return 'bg-purple-500 hover:bg-purple-600'
      case 'teal':
        return 'bg-teal-500 hover:bg-teal-600'
      case 'amber':
        return 'bg-amber-500 hover:bg-amber-600'
      case 'indigo':
        return 'bg-indigo-500 hover:bg-indigo-600'
      case 'neutral':
        return 'bg-neutral-500 hover:bg-neutral-600'
      default:
        return 'bg-blue-500 hover:bg-blue-600'
    }
  }

  const colors = [
    'sky',
    'green',
    'yellow',
    'red',
    'purple',
    'teal',
    'amber',
    'indigo',
    'neutral',
    'blue',
  ]

  return (
    <NodeViewWrapper className={`block-button ${getAlignmentClass()}`}>
      <div className="inline-block">
        <button
          onClick={isEditable ? undefined : () => window.open(link, '_blank')}
          className={twMerge(
            'flex items-center space-x-2 rounded-xl px-4 py-2 text-white transition-colors',
            getButtonColor(color),
            isEditable && 'pointer-events-none',
            !link && 'opacity-60'
          )}
        >
          <span>{emoji}</span>
          <NodeViewContent className="content" />
          <ArrowRight size={14} />
        </button>
        {isEditable && (
          <div className="mt-2 flex space-x-2">
            <button
              onClick={() => setShowEmojiPicker(!showEmojiPicker)}
              className="rounded-md bg-gray-200 p-1"
            >
              <ChevronDown size={14} />
            </button>
            <button
              onClick={() => setShowLinkInput(!showLinkInput)}
              className="rounded-md bg-gray-200 p-1"
            >
              <Link size={14} />
            </button>
            <button
              onClick={() => handleAlignmentChange('left')}
              className="rounded-md bg-gray-200 p-1"
            >
              <AlignLeft size={14} />
            </button>
            <button
              onClick={() => handleAlignmentChange('center')}
              className="rounded-md bg-gray-200 p-1"
            >
              <AlignCenter size={14} />
            </button>
            <button
              onClick={() => handleAlignmentChange('right')}
              className="rounded-md bg-gray-200 p-1"
            >
              <AlignRight size={14} />
            </button>
            <button
              onClick={() => setShowColorPicker(!showColorPicker)}
              className="rounded-md bg-gray-200 p-1"
            >
              <Palette size={14} />
            </button>
          </div>
        )}
      </div>
      {isEditable && showEmojiPicker && (
        <div ref={pickerRef}>
          <Picker onEmojiSelect={handleEmojiSelect} />
        </div>
      )}
      {isEditable && showLinkInput && (
        <input
          ref={linkInputRef}
          type="text"
          value={link}
          onChange={handleLinkChange}
          placeholder="Enter link URL"
          className="mt-2 w-full rounded-md border p-2"
        />
      )}
      {isEditable && showColorPicker && (
        <div
          ref={colorPickerRef}
          className="nice-shadow absolute mt-2 rounded-md bg-white p-2"
        >
          <div className="flex flex-wrap gap-2">
            {colors.map((c) => (
              <button
                key={c}
                className={`h-6 w-6 rounded-full ${getButtonColor(c)} hover:ring-opacity-50 focus:ring-opacity-50 hover:ring-2 focus:ring-2 focus:outline-hidden`}
                onClick={() => handleColorSelect(c)}
              />
            ))}
          </div>
        </div>
      )}
    </NodeViewWrapper>
  )
}

export default ButtonsExtension
