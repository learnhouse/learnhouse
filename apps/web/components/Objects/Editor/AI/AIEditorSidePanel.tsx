'use client'

import React, { useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import Image from 'next/image'
import { Editor } from '@tiptap/react'
import {
  X,
  FlaskConical,
  MessageCircle,
  AlertTriangle,
  Sparkles,
  Wand2,
  ListPlus,
  FileText,
  RotateCcw,
  HelpCircle,
  Languages,
  CheckSquare,
  Lightbulb,
  BookOpen,
  Type,
  Box,
} from 'lucide-react'
import learnhouseAI_icon from 'public/learnhouse_ai_simple.png'
import learnhouseAI_logo_black from 'public/learnhouse_ai_black_logo.png'
import {
  AIEditorStateTypes,
  useAIEditor,
  useAIEditorDispatch,
} from '@components/Contexts/AI/AIEditorContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import {
  startEditorAIChatSessionStream,
  sendEditorAIChatMessageStream,
  EditorStreamCallbacks,
} from '@services/ai/ai'
import UserAvatar from '@components/Objects/UserAvatar'
import { useTranslation } from 'react-i18next'
import AIMarkdownRenderer from '@components/Objects/Activities/AI/AIMarkdownRenderer'
import { setAIHighlight, clearAIHighlight } from '../Extensions/AISelectionHighlight/AISelectionHighlight'

type AIEditorSidePanelProps = {
  editor: Editor
  activity: any
  course: any
}

type AIMessage = {
  sender: string
  message: any
  type: 'ai' | 'user'
}

function AIEditorSidePanel(props: AIEditorSidePanelProps) {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const aiEditorState = useAIEditor() as AIEditorStateTypes
  const dispatchAIEditor = useAIEditorDispatch() as any
  const isInitialRender = useRef(true)

  const isInputDisabled =
    aiEditorState.isWaitingForResponse || aiEditorState.isStreaming
  const inputClass = isInputDisabled
    ? 'ring-1 ring-inset ring-white/10 bg-gray-950/40 w-full rounded-lg outline-hidden px-4 py-2 text-white text-sm placeholder:text-white/30 opacity-30'
    : 'ring-1 ring-inset ring-white/10 bg-gray-950/40 w-full rounded-lg outline-hidden px-4 py-2 text-white text-sm placeholder:text-white/30'

  const accumulatedContentRef = useRef('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)

  // Initialize after a short delay to prevent animation on page load
  useEffect(() => {
    const timer = setTimeout(() => {
      isInitialRender.current = false
    }, 100)
    return () => clearTimeout(timer)
  }, [])

  const scrollToBottom = () => {
    if (messagesContainerRef.current) {
      const container = messagesContainerRef.current
      const targetScroll = container.scrollHeight - container.clientHeight
      container.scrollTo({
        top: targetScroll,
        behavior: 'smooth',
      })
    }
  }

  useEffect(() => {
    const timer = setTimeout(scrollToBottom, 50)
    return () => clearTimeout(timer)
  }, [aiEditorState.messages, aiEditorState.streamingContent])

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && aiEditorState.isSidePanelOpen) {
        dispatchAIEditor({ type: 'setSidePanelClose' })
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [aiEditorState.isSidePanelOpen, dispatchAIEditor])

  // Block type labels for user-friendly display
  const BLOCK_TYPE_LABELS: Record<string, string> = {
    blockQuiz: 'Quiz',
    blockImage: 'Image',
    blockVideo: 'Video',
    blockPDF: 'PDF',
    blockEmbed: 'Embed',
    blockMathEquation: 'Math Equation',
    blockWebPreview: 'Web Preview',
    blockUser: 'User',
    blockMagic: 'Magic Block',
    scenarios: 'Scenarios',
    calloutInfo: 'Info Callout',
    calloutWarning: 'Warning Callout',
    badge: 'Badge',
    button: 'Button',
    flipcard: 'Flashcard',
    codeBlock: 'Code Block',
    blockquote: 'Quote',
    table: 'Table',
    bulletList: 'Bullet List',
    orderedList: 'Numbered List',
    heading: 'Heading',
  }

  // Block types that are "interesting" to highlight (not just paragraphs)
  const INTERESTING_BLOCK_TYPES = [
    'blockQuiz', 'blockImage', 'blockVideo', 'blockPDF', 'blockEmbed',
    'blockMathEquation', 'blockWebPreview', 'blockUser', 'blockMagic',
    'scenarios', 'calloutInfo', 'calloutWarning', 'badge', 'button',
    'flipcard', 'codeBlock', 'blockquote', 'table', 'bulletList',
    'orderedList', 'heading',
  ]

  // Find the nearest interesting block at the cursor position
  const findBlockContext = () => {
    if (!props.editor) return null

    const { state } = props.editor
    const { selection } = state

    // Check if this is a NodeSelection (atomic block selected)
    // NodeSelection has a 'node' property
    if ('node' in selection && selection.node) {
      const node = selection.node as any
      const nodeType = node.type.name

      if (INTERESTING_BLOCK_TYPES.includes(nodeType)) {
        return {
          type: nodeType,
          from: selection.from,
          to: selection.to,
          label: BLOCK_TYPE_LABELS[nodeType] || nodeType,
        }
      }
    }

    // For text selection or cursor, walk up the node tree
    const { $from } = selection

    for (let depth = $from.depth; depth >= 0; depth--) {
      const node = $from.node(depth)
      const nodeType = node.type.name

      if (INTERESTING_BLOCK_TYPES.includes(nodeType)) {
        const start = $from.before(depth)
        const end = $from.after(depth)
        return {
          type: nodeType,
          from: start,
          to: end,
          label: BLOCK_TYPE_LABELS[nodeType] || nodeType,
        }
      }
    }

    return null
  }

  // Capture and highlight selection/block context
  const captureAndHighlightSelection = () => {
    if (!props.editor) return

    const selection = props.editor.state.selection

    // First, check if an atomic block is selected (NodeSelection)
    if ('node' in selection && selection.node) {
      const node = selection.node as any
      const nodeType = node.type.name

      if (INTERESTING_BLOCK_TYPES.includes(nodeType)) {
        const blockContext = {
          type: nodeType,
          from: selection.from,
          to: selection.to,
          label: BLOCK_TYPE_LABELS[nodeType] || nodeType,
        }

        // Clear text selection, set block context
        selectionRangeRef.current = null
        dispatchAIEditor({ type: 'clearPersistentSelection' })
        dispatchAIEditor({
          type: 'setActiveBlockContext',
          payload: blockContext,
        })

        // Highlight the block
        setAIHighlight(props.editor, { from: blockContext.from, to: blockContext.to })
        return
      }
    }

    // Check for text selection
    const hasTextSelection = !selection.empty

    if (hasTextSelection) {
      const from = selection.from
      const to = selection.to

      // Store selection in ref for later use
      selectionRangeRef.current = { from, to }

      // Store in context
      dispatchAIEditor({
        type: 'setPersistentSelection',
        payload: { from, to },
      })

      // Clear any block context since we have text selection
      dispatchAIEditor({ type: 'clearActiveBlockContext' })

      // Apply the highlight decoration
      setAIHighlight(props.editor, { from, to })
      return
    }

    // No text selection - check if cursor is inside an interesting block
    const blockContext = findBlockContext()

    if (blockContext) {
      // Clear text selection, set block context
      selectionRangeRef.current = null
      dispatchAIEditor({ type: 'clearPersistentSelection' })
      dispatchAIEditor({
        type: 'setActiveBlockContext',
        payload: blockContext,
      })

      // Highlight the entire block
      setAIHighlight(props.editor, { from: blockContext.from, to: blockContext.to })
    } else {
      // Nothing interesting selected - clear everything
      clearAIHighlight(props.editor)
      selectionRangeRef.current = null
      dispatchAIEditor({ type: 'clearPersistentSelection' })
      dispatchAIEditor({ type: 'clearActiveBlockContext' })
    }
  }

  // Clear the highlight and context
  const clearSelectionHighlight = () => {
    if (!props.editor) return

    clearAIHighlight(props.editor)
    selectionRangeRef.current = null
    dispatchAIEditor({ type: 'clearPersistentSelection' })
    dispatchAIEditor({ type: 'clearActiveBlockContext' })
  }

  // Clear highlight when side panel closes
  useEffect(() => {
    if (!aiEditorState.isSidePanelOpen) {
      clearSelectionHighlight()
    }
  }, [aiEditorState.isSidePanelOpen])

  // Listen for editor selection changes when side panel is open
  useEffect(() => {
    if (!props.editor || !aiEditorState.isSidePanelOpen) return

    const handleSelectionUpdate = () => {
      // Only auto-update if the editor has focus (user is interacting with it)
      if (props.editor.isFocused) {
        captureAndHighlightSelection()
      }
    }

    props.editor.on('selectionUpdate', handleSelectionUpdate)

    return () => {
      props.editor.off('selectionUpdate', handleSelectionUpdate)
    }
  }, [props.editor, aiEditorState.isSidePanelOpen])

  // Handle input focus - always capture current selection
  const handleInputFocus = () => {
    captureAndHighlightSelection()
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      sendMessage(aiEditorState.chatInputValue)
    }
  }

  const handleChange = async (
    event: React.ChangeEvent<HTMLTextAreaElement>
  ) => {
    await dispatchAIEditor({
      type: 'setChatInputValue',
      payload: event.currentTarget.value,
    })
  }

  // Ref to track if we're in content streaming mode
  const isStreamingContentRef = useRef(false)
  const contentBufferRef = useRef('')
  const selectionRangeRef = useRef<{ from: number; to: number } | null>(null)
  const insertPositionRef = useRef<number | null>(null)
  const streamingStartPosRef = useRef<number | null>(null)

  // Block types that are truly atomic (atom: true, no editable content)
  const ATOMIC_BLOCK_TYPES = [
    'blockQuiz',
    'blockImage',
    'blockVideo',
    'blockPDF',
    'blockEmbed',
    'blockMathEquation',
    'blockWebPreview',
    'blockUser',
    'blockMagic',
    'scenarios',
  ]

  // Block types that have content but need direct insertion (React node views)
  const SPECIAL_BLOCK_TYPES = [
    'calloutInfo',
    'calloutWarning',
    'badge',
    'button',
    'flipcard',
  ]

  // Block types that require direct text content (NOT wrapped in paragraphs)
  const DIRECT_TEXT_BLOCK_TYPES = [
    'calloutInfo',
    'calloutWarning',
    'badge',
    'button',
  ]

  /**
   * Transform content to fix common AI output issues.
   * Specifically handles blocks that require direct text nodes (not paragraphs).
   */
  const transformContentForInsertion = (content: any): any => {
    if (Array.isArray(content)) {
      return content.map(transformContentForInsertion)
    }

    if (typeof content !== 'object' || content === null) {
      return content
    }

    // Check if this is a direct-text block with incorrectly wrapped paragraphs
    if (DIRECT_TEXT_BLOCK_TYPES.includes(content.type) && content.content) {
      // Check if content is wrapped in paragraphs
      const unwrappedContent: any[] = []

      for (const node of content.content) {
        if (node.type === 'paragraph' && node.content) {
          // Extract text nodes from paragraph
          for (const textNode of node.content) {
            if (textNode.type === 'text') {
              unwrappedContent.push(textNode)
            }
          }
        } else if (node.type === 'text') {
          // Already a direct text node - keep it
          unwrappedContent.push(node)
        }
      }

      if (unwrappedContent.length > 0) {
        return {
          ...content,
          content: unwrappedContent,
        }
      }
    }

    // Recursively process content arrays for nested structures
    if (content.content) {
      return {
        ...content,
        content: transformContentForInsertion(content.content),
      }
    }

    return content
  }

  /**
   * Check if a node type is atomic (no content, just attrs)
   */
  const isAtomicBlock = (type: string): boolean => {
    return ATOMIC_BLOCK_TYPES.includes(type)
  }

  /**
   * Check if a node type is a special block (needs direct insertion)
   */
  const isSpecialBlock = (type: string): boolean => {
    return SPECIAL_BLOCK_TYPES.includes(type) || ATOMIC_BLOCK_TYPES.includes(type)
  }

  /**
   * Add AI streaming marks to all text nodes in a TipTap JSON structure
   * Skips special blocks that don't support streaming marks
   */
  const addStreamingMarksToContent = (content: any): any => {
    if (Array.isArray(content)) {
      return content.map(addStreamingMarksToContent)
    }

    if (typeof content !== 'object' || content === null) {
      return content
    }

    // Skip special blocks entirely - they don't need streaming marks
    if (content.type && isSpecialBlock(content.type)) {
      return content
    }

    // If this is a text node, add the aiStreaming mark
    if (content.type === 'text') {
      const marks = content.marks || []
      return {
        ...content,
        marks: [...marks, { type: 'aiStreaming' }],
      }
    }

    // Recursively process content array
    if (content.content) {
      return {
        ...content,
        content: addStreamingMarksToContent(content.content),
      }
    }

    return content
  }

  /**
   * Remove AI streaming marks from a range in the editor
   */
  const removeStreamingMarks = (startPos: number, endPos: number) => {
    if (startPos < endPos) {
      props.editor
        .chain()
        .focus()
        .setTextSelection({ from: startPos, to: endPos })
        .unsetMark('aiStreaming')
        .setTextSelection(endPos)
        .run()
    }
  }

  /**
   * Insert a single TipTap JSON node with appropriate handling
   */
  const insertSingleNode = (node: any, startPos: number): number => {
    const isSpecial = node.type && isSpecialBlock(node.type)

    // For special blocks (atomic or with React node views), insert directly
    if (isSpecial) {
      const cleanContent = JSON.parse(JSON.stringify(node))

      try {
        const editor = props.editor
        const schemaNodeType = editor.schema.nodes[cleanContent.type]

        if (!schemaNodeType) {
          return props.editor.state.selection.from
        }

        editor.chain().focus().insertContent(cleanContent).run()
      } catch {
        // Fallback: try with just type and attrs
        try {
          props.editor.chain().focus().insertContent({
            type: node.type,
            attrs: node.attrs || {}
          }).run()
        } catch {
          // Silent fail
        }
      }
    } else {
      // For regular content, add streaming marks
      const nodeWithMarks = addStreamingMarksToContent(node)
      props.editor.chain().focus().insertContent(nodeWithMarks).run()
    }

    return props.editor.state.selection.from
  }

  /**
   * Insert TipTap JSON content with gradient animation
   */
  const insertContentWithAnimation = (content: any) => {
    try {
      // Ensure content is an object, not a string
      if (typeof content === 'string') {
        try {
          content = JSON.parse(content)
        } catch {
          props.editor.chain().focus().insertContent({
            type: 'paragraph',
            content: [{ type: 'text', text: content }]
          }).run()
          return
        }
      }

      const startPos = props.editor.state.selection.from

      // Handle arrays of nodes - process each node individually
      if (Array.isArray(content)) {
        for (const node of content) {
          if (node && node.type) {
            insertSingleNode(node, startPos)
          }
        }

        const endPos = props.editor.state.selection.from

        // Schedule removal of streaming marks after animation
        if (startPos < endPos) {
          setTimeout(() => {
            removeStreamingMarks(startPos, endPos)
          }, 1500)
        }
        return
      }

      // Single node - check block type
      const isSpecial = content.type && isSpecialBlock(content.type)

      // Check if the node type exists in the schema
      if (content.type) {
        const nodeExists = !!props.editor.schema.nodes[content.type]
        if (!nodeExists) {
          return
        }
      }

      // For special blocks (atomic or with React node views), insert directly
      if (isSpecial) {
        const cleanContent = JSON.parse(JSON.stringify(content))

        try {
          const editor = props.editor
          const schemaNodeType = editor.schema.nodes[cleanContent.type]
          if (!schemaNodeType) {
            return
          }

          editor.chain().focus().insertContent(cleanContent).run()
        } catch {
          // Fallback: try with just type and attrs (no content)
          try {
            props.editor.chain().focus().insertContent({
              type: content.type,
              attrs: content.attrs || {}
            }).run()
          } catch {
            // Silent fail
          }
        }
        return
      }

      // For non-atomic content, add streaming marks for animation
      const contentWithMarks = addStreamingMarksToContent(content)
      props.editor.chain().focus().insertContent(contentWithMarks).run()

      const endPos = props.editor.state.selection.from

      // Schedule removal of streaming marks after animation
      if (startPos < endPos) {
        setTimeout(() => {
          removeStreamingMarks(startPos, endPos)
        }, 1500)
      }
    } catch {
      // Fallback: try inserting as plain text
      const textContent = typeof content === 'string' ? content : JSON.stringify(content)
      props.editor.chain().focus().insertContent({
        type: 'paragraph',
        content: [{ type: 'text', text: textContent }]
      }).run()
    }
  }

  const sendMessage = async (message: string) => {
    if (!message.trim()) return

    await dispatchAIEditor({ type: 'clearFollowUpSuggestions' })
    accumulatedContentRef.current = ''
    contentBufferRef.current = ''
    isStreamingContentRef.current = false
    streamingStartPosRef.current = null

    // Add user message
    await dispatchAIEditor({
      type: 'addMessage',
      payload: { sender: 'user', message: message, type: 'user' },
    })

    // Set loading states
    await dispatchAIEditor({ type: 'setIsWaitingForResponse' })
    await dispatchAIEditor({ type: 'setIsStreaming' })
    await dispatchAIEditor({ type: 'setChatInputValue', payload: '' })

    // Get current editor content and selection info
    const currentContent = props.editor.getJSON()
    const selection = props.editor.state.selection
    const hasSelection = !selection.empty

    const selectedText = hasSelection
      ? props.editor.state.doc.textBetween(selection.from, selection.to)
      : undefined

    // Store selection range for later use
    if (hasSelection) {
      selectionRangeRef.current = { from: selection.from, to: selection.to }
    } else {
      selectionRangeRef.current = null
      insertPositionRef.current = selection.from
    }

    // Store current editor content for context
    await dispatchAIEditor({
      type: 'setCurrentEditorContent',
      payload: currentContent,
    })

    const callbacks: EditorStreamCallbacks = {
      onStart: (data) => {
        if (data.aichat_uuid) {
          dispatchAIEditor({ type: 'setAichat_uuid', payload: data.aichat_uuid })
        }
      },
      onChatChunk: (chunk) => {
        // Only add to chat if we're not in content streaming mode
        if (!isStreamingContentRef.current) {
          accumulatedContentRef.current += chunk
          dispatchAIEditor({ type: 'appendStreamingContent', payload: chunk })
        }
      },
      onContentStart: () => {
        isStreamingContentRef.current = true
        contentBufferRef.current = ''

        // If there was selected text, delete it first
        if (selectionRangeRef.current) {
          props.editor
            .chain()
            .focus()
            .setTextSelection(selectionRangeRef.current)
            .deleteSelection()
            .run()
          // Update insert position to where selection was
          insertPositionRef.current = selectionRangeRef.current.from
          selectionRangeRef.current = null
        }

        // Store the starting position for content insertion
        streamingStartPosRef.current = props.editor.state.selection.from
      },
      onContentChunk: (chunk) => {
        // Buffer all content - we'll parse and insert when complete
        contentBufferRef.current += chunk
      },
      onContentEnd: (fullContent) => {
        isStreamingContentRef.current = false

        // Clean up the content - remove extra whitespace and newlines
        let cleanContent = fullContent.trim()
        cleanContent = cleanContent.replace(/^\n+|\n+$/g, '').trim()
        cleanContent = cleanContent.replace(/[\x00-\x1F\x7F]/g, '')
        cleanContent = cleanContent.trim()
        cleanContent = cleanContent.replace(/,(\s*[\]}])/g, '$1')

        // Count brackets to check if JSON is complete
        let openBraces = 0
        let openBrackets = 0
        let inString = false
        let escapeNext = false

        for (let i = 0; i < cleanContent.length; i++) {
          const char = cleanContent[i]
          if (escapeNext) {
            escapeNext = false
            continue
          }
          if (char === '\\') {
            escapeNext = true
            continue
          }
          if (char === '"') {
            inString = !inString
            continue
          }
          if (!inString) {
            if (char === '{') openBraces++
            else if (char === '}') openBraces--
            else if (char === '[') openBrackets++
            else if (char === ']') openBrackets--
          }
        }

        // If JSON is incomplete, try to close it
        if (openBraces > 0 || openBrackets > 0) {
          while (openBrackets > 0) {
            cleanContent += ']'
            openBrackets--
          }
          while (openBraces > 0) {
            cleanContent += '}'
            openBraces--
          }
        }

        if (cleanContent.startsWith('{') && !cleanContent.endsWith('}')) {
          cleanContent += '}'
        } else if (cleanContent.startsWith('[') && !cleanContent.endsWith(']')) {
          cleanContent += ']'
        }

        // Helper function to validate and insert content
        const validateAndInsert = (parsed: any) => {
          const transformed = transformContentForInsertion(parsed)

          if (Array.isArray(transformed)) {
            const isValid = transformed.every((node: any) => node && typeof node.type === 'string')
            if (!isValid) {
              return false
            }
          } else if (!transformed || typeof transformed.type !== 'string') {
            return false
          }

          insertContentWithAnimation(transformed)
          return true
        }

        // Try to parse as TipTap JSON
        try {
          if (cleanContent.startsWith('{') || cleanContent.startsWith('[')) {
            let parsed: any
            try {
              parsed = JSON.parse(cleanContent)
            } catch (initialError) {
              let fixedContent = cleanContent
              fixedContent = fixedContent.replace(/(?<!\\)\n/g, '\\n')
              fixedContent = fixedContent.replace(/(?<!\\)\t/g, '\\t')
              fixedContent = fixedContent.replace(/(?<!\\)\r/g, '\\r')

              try {
                parsed = JSON.parse(fixedContent)
              } catch {
                throw initialError
              }
            }

            if (validateAndInsert(parsed)) {
              return
            }
            throw new Error('Invalid TipTap content structure')
          } else {
            const textContent = {
              type: 'paragraph',
              content: [{ type: 'text', text: cleanContent }],
            }
            insertContentWithAnimation(textContent)
          }
        } catch {
          // Try multiple recovery strategies

          // Strategy 1: Check if content is double-escaped JSON string
          if (cleanContent.startsWith('"') && cleanContent.endsWith('"')) {
            try {
              const unescaped = JSON.parse(cleanContent)
              if (typeof unescaped === 'string') {
                const innerParsed = JSON.parse(unescaped)
                if (validateAndInsert(innerParsed)) {
                  return
                }
              }
            } catch {
              // Continue to next strategy
            }
          }

          // Strategy 2: Extract JSON from markdown code blocks
          const jsonMatch = cleanContent.match(/```(?:json)?\s*([\s\S]*?)```/)
          if (jsonMatch) {
            try {
              const extracted = jsonMatch[1].trim()
              const parsed = JSON.parse(extracted)
              if (validateAndInsert(parsed)) {
                return
              }
            } catch {
              // Continue to next strategy
            }
          }

          // Strategy 3: Try to find JSON object/array in the content
          const jsonObjectMatch = cleanContent.match(/(\{[\s\S]*\}|\[[\s\S]*\])/)
          if (jsonObjectMatch) {
            try {
              const extracted = jsonObjectMatch[1]
              const parsed = JSON.parse(extracted)
              if (validateAndInsert(parsed)) {
                return
              }
            } catch {
              // Continue to fallback
            }
          }

          // Last resort: insert as plain text paragraph
          const textContent = {
            type: 'paragraph',
            content: [{ type: 'text', text: cleanContent }],
          }
          insertContentWithAnimation(textContent)
        }
      },
      onComplete: (data) => {
        const finalContent = accumulatedContentRef.current
        if (finalContent.trim()) {
          dispatchAIEditor({
            type: 'addMessage',
            payload: { sender: 'ai', message: finalContent, type: 'ai' },
          })
        }

        dispatchAIEditor({ type: 'setStreamingComplete' })
        dispatchAIEditor({ type: 'clearStreamingContent' })
        dispatchAIEditor({ type: 'setIsNoLongerWaitingForResponse' })

        if (data.aichat_uuid) {
          dispatchAIEditor({ type: 'setAichat_uuid', payload: data.aichat_uuid })
        }

        dispatchAIEditor({ type: 'setIsLoadingFollowUps' })
        accumulatedContentRef.current = ''
        contentBufferRef.current = ''

        // Clear the selection highlight after response completes
        clearSelectionHighlight()
      },
      onFollowUps: (suggestions) => {
        if (suggestions && suggestions.length > 0) {
          dispatchAIEditor({
            type: 'setFollowUpSuggestions',
            payload: suggestions,
          })
        } else {
          dispatchAIEditor({ type: 'setIsNotLoadingFollowUps' })
        }
      },
      onError: (error) => {
        dispatchAIEditor({ type: 'setStreamingComplete' })
        dispatchAIEditor({ type: 'setIsNoLongerWaitingForResponse' })
        dispatchAIEditor({ type: 'clearStreamingContent' })
        dispatchAIEditor({ type: 'setIsNotLoadingFollowUps' })
        accumulatedContentRef.current = ''
        contentBufferRef.current = ''
        isStreamingContentRef.current = false
        // Clear the selection highlight on error
        clearSelectionHighlight()
        dispatchAIEditor({
          type: 'setError',
          payload: {
            isError: true,
            status: 500,
            error_message: error,
          },
        })
      },
    }

    const request = {
      message,
      activity_uuid: props.activity.activity_uuid,
      current_content: currentContent,
      selected_text: selectedText,
      aichat_uuid: aiEditorState.aichat_uuid,
      cursor_position: insertPositionRef.current || undefined,
    }

    if (aiEditorState.aichat_uuid) {
      await sendEditorAIChatMessageStream(request, access_token, callbacks)
    } else {
      await startEditorAIChatSessionStream(request, access_token, callbacks)
    }
  }

  function closeSidePanel() {
    dispatchAIEditor({ type: 'setSidePanelClose' })
  }

  function clearChat() {
    dispatchAIEditor({ type: 'resetSidePanelState' })
  }

  // Quick action handlers
  const quickActions = [
    {
      label: t('editor.ai_panel.improve_writing'),
      icon: <Sparkles size={12} />,
      prompt: 'Improve the writing quality of the selected text or the last paragraph',
    },
    {
      label: t('editor.ai_panel.add_examples'),
      icon: <ListPlus size={12} />,
      prompt: 'Add relevant examples to help illustrate the concepts in this content',
    },
    {
      label: t('editor.ai_panel.simplify'),
      icon: <Wand2 size={12} />,
      prompt: 'Simplify this content to make it easier to understand',
    },
    {
      label: t('editor.ai_panel.expand'),
      icon: <FileText size={12} />,
      prompt: 'Expand on this content with more detail and explanation',
    },
    {
      label: t('editor.ai_panel.add_quiz'),
      icon: <HelpCircle size={12} />,
      prompt: 'Add a quiz with 3 questions to test understanding of the key concepts',
    },
    {
      label: t('editor.ai_panel.translate'),
      icon: <Languages size={12} />,
      prompt: 'Translate this content to English (or if already in English, translate to Spanish)',
    },
    {
      label: t('editor.ai_panel.add_summary'),
      icon: <CheckSquare size={12} />,
      prompt: 'Add a brief summary section highlighting the key takeaways',
    },
    {
      label: t('editor.ai_panel.add_tip'),
      icon: <Lightbulb size={12} />,
      prompt: 'Add a helpful tip or pro tip callout related to this content',
    },
    {
      label: t('editor.ai_panel.add_definition'),
      icon: <BookOpen size={12} />,
      prompt: 'Add a definition or explanation block for the key terms in this content',
    },
  ]

  if (!aiEditorState.isSidePanelOpen) {
    return null
  }

  return (
    <motion.div
      initial={isInitialRender.current ? false : { opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      transition={
        isInitialRender.current
          ? { duration: 0 }
          : {
              type: 'spring',
              bounce: 0.2,
              duration: 0.4,
            }
      }
      className="w-[400px] flex-shrink-0 mt-[120px] sticky top-[120px] self-start"
    >
      <div
        className="rounded-xl h-[calc(100vh-170px)] flex flex-col ring-1 ring-inset ring-white/10"
        style={{
          background:
            'linear-gradient(0deg, rgba(0, 0, 0, 0.2) 0%, rgba(0, 0, 0, 0.2) 100%), radial-gradient(105.16% 105.16% at 50% -5.16%, rgba(255, 255, 255, 0.18) 0%, rgba(0, 0, 0, 0) 100%), rgb(2 1 25 / 98%)',
        }}
      >
        {/* Header */}
        <div className="flex py-3 px-4 justify-between items-center border-b border-white/10">
          <div
            className={`flex space-x-2 items-center ${
              isInputDisabled ? 'animate-pulse' : ''
            }`}
          >
            <Image
              className={`outline outline-1 outline-neutral-200/20 rounded-lg ${
                isInputDisabled ? 'animate-pulse' : ''
              }`}
              width={24}
              src={learnhouseAI_icon}
              alt=""
            />
            <span className="text-sm font-semibold text-white/80">
              {t('editor.ai_panel.title')}
            </span>
            <div className="bg-white/5 text-white/40 py-0.5 px-2 flex space-x-1 rounded-full items-center">
              <FlaskConical size={10} />
              <span className="text-[9px] font-semibold">
                {t('ai.experimental')}
              </span>
            </div>
          </div>
          <div className="flex space-x-1 items-center">
            {aiEditorState.messages.length > 0 && (
              <button
                onClick={clearChat}
                title={t('editor.ai_panel.clear_chat')}
                className="text-white/50 hover:text-white/70 hover:cursor-pointer bg-white/10 p-1 rounded-full items-center transition-colors"
              >
                <RotateCcw size={12} />
              </button>
            )}
            <X
              size={20}
              className="text-white/50 hover:text-white/70 hover:cursor-pointer bg-white/10 p-1 rounded-full items-center transition-colors"
              onClick={closeSidePanel}
            />
          </div>
        </div>

        {/* Messages Area */}
        {aiEditorState.messages.length > 0 && !aiEditorState.error.isError ? (
          <div
            ref={messagesContainerRef}
            className="flex flex-col flex-1 w-full space-y-3 overflow-y-auto scroll-smooth p-4"
            style={{
              scrollbarWidth: 'thin',
              scrollbarColor: 'rgba(255,255,255,0.1) transparent',
            }}
          >
            <AnimatePresence mode="popLayout">
              {aiEditorState.messages.map(
                (message: AIMessage, index: number) => (
                  <motion.div
                    key={`editor-msg-${index}`}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{
                      duration: 0.3,
                      ease: [0.25, 0.46, 0.45, 0.94],
                    }}
                  >
                    <AIEditorMessageComponent
                      message={message}
                      isAI={message.sender === 'ai'}
                    />
                  </motion.div>
                )
              )}
            </AnimatePresence>

            {/* Thinking indicator */}
            <AnimatePresence>
              {aiEditorState.isStreaming &&
                !aiEditorState.streamingContent && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="flex space-x-3 w-full antialiased font-medium"
                  >
                    <div className="shrink-0">
                      <UserAvatar
                        rounded="rounded-lg"
                        border="border-2"
                        predefined_avatar="ai"
                        width={32}
                        shadow="shadow-none"
                      />
                    </div>
                    <div className="flex items-center space-x-1.5 px-2 py-2">
                      <motion.span
                        className="w-2 h-2 bg-purple-400/80 rounded-full"
                        animate={{
                          opacity: [0.4, 1, 0.4],
                          scale: [0.85, 1, 0.85],
                        }}
                        transition={{
                          duration: 1.2,
                          repeat: Infinity,
                          ease: 'easeInOut',
                        }}
                      />
                      <motion.span
                        className="w-2 h-2 bg-purple-400/80 rounded-full"
                        animate={{
                          opacity: [0.4, 1, 0.4],
                          scale: [0.85, 1, 0.85],
                        }}
                        transition={{
                          duration: 1.2,
                          repeat: Infinity,
                          ease: 'easeInOut',
                          delay: 0.2,
                        }}
                      />
                      <motion.span
                        className="w-2 h-2 bg-purple-400/80 rounded-full"
                        animate={{
                          opacity: [0.4, 1, 0.4],
                          scale: [0.85, 1, 0.85],
                        }}
                        transition={{
                          duration: 1.2,
                          repeat: Infinity,
                          ease: 'easeInOut',
                          delay: 0.4,
                        }}
                      />
                    </div>
                  </motion.div>
                )}
            </AnimatePresence>

            {/* Streaming content */}
            <AnimatePresence>
              {aiEditorState.isStreaming &&
                aiEditorState.streamingContent && (
                  <motion.div
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2, ease: 'easeOut' }}
                  >
                    <AIEditorMessageComponent
                      message={{
                        sender: 'ai',
                        message: aiEditorState.streamingContent,
                        type: 'ai',
                      }}
                      isAI={true}
                      isStreaming={true}
                    />
                  </motion.div>
                )}
            </AnimatePresence>

            {/* Follow-up suggestions */}
            <AnimatePresence>
              {!aiEditorState.isStreaming && (
                <>
                  {aiEditorState.isLoadingFollowUps &&
                    aiEditorState.followUpSuggestions.length === 0 && (
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="flex justify-center items-center gap-1.5 text-white/30 text-xs py-2"
                      >
                        <motion.span
                          className="w-1 h-1 bg-white/40 rounded-full"
                          animate={{ opacity: [0.3, 0.8, 0.3] }}
                          transition={{
                            duration: 1,
                            repeat: Infinity,
                            ease: 'easeInOut',
                          }}
                        />
                        <motion.span
                          className="w-1 h-1 bg-white/40 rounded-full"
                          animate={{ opacity: [0.3, 0.8, 0.3] }}
                          transition={{
                            duration: 1,
                            repeat: Infinity,
                            ease: 'easeInOut',
                            delay: 0.15,
                          }}
                        />
                        <motion.span
                          className="w-1 h-1 bg-white/40 rounded-full"
                          animate={{ opacity: [0.3, 0.8, 0.3] }}
                          transition={{
                            duration: 1,
                            repeat: Infinity,
                            ease: 'easeInOut',
                            delay: 0.3,
                          }}
                        />
                      </motion.div>
                    )}
                  {aiEditorState.followUpSuggestions.length > 0 && (
                    <motion.div
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.3, ease: 'easeOut' }}
                      className="flex flex-wrap gap-2 pt-2"
                    >
                      {aiEditorState.followUpSuggestions.map(
                        (suggestion, idx) => (
                          <button
                            key={idx}
                            onClick={() => sendMessage(suggestion)}
                            disabled={isInputDisabled}
                            className="px-3 py-1.5 text-xs bg-white/5 text-white/60 rounded-full hover:bg-white/10 hover:text-white/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {suggestion}
                          </button>
                        )
                      )}
                    </motion.div>
                  )}
                </>
              )}
            </AnimatePresence>
            <div ref={messagesEndRef} />
          </div>
        ) : (
          <AIEditorSidePanelPlaceholder sendMessage={sendMessage} />
        )}

        {/* Error state */}
        {aiEditorState.error.isError && (
          <div className="flex items-center justify-center flex-1 p-4">
            <div className="flex flex-col mx-auto w-full space-y-2 p-4 rounded-lg bg-red-500/20 outline outline-1 outline-red-500">
              <AlertTriangle size={20} className="text-red-500" />
              <div className="flex flex-col">
                <h3 className="font-semibold text-red-200">
                  {t('common.something_wrong_happened')}
                </h3>
                <span className="text-red-100 text-sm">
                  {aiEditorState.error.error_message}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Quick Actions */}
        <div className="px-4 py-2 border-t border-white/5">
          <div className="flex flex-wrap gap-2">
            {quickActions.map((action, idx) => (
              <button
                key={idx}
                onClick={() => sendMessage(action.prompt)}
                disabled={isInputDisabled}
                className="flex items-center gap-1.5 px-3 py-1 text-xs bg-white/5 text-white/60 rounded-full hover:bg-white/10 hover:text-white/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {action.icon}
                <span>{action.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Input Area */}
        <div className="p-4 border-t border-white/10">
          {/* Context indicators - show either text selection or block context */}
          <AnimatePresence>
            {/* Text selection indicator */}
            {aiEditorState.persistentSelection && !aiEditorState.activeBlockContext && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2 }}
                className="mb-3"
              >
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-purple-500/10 border border-purple-500/20">
                  <Type size={14} className="text-purple-400 flex-shrink-0" />
                  <span className="text-xs text-purple-300/80 truncate">
                    {(() => {
                      const sel = aiEditorState.persistentSelection
                      if (sel && props.editor) {
                        const text = props.editor.state.doc.textBetween(sel.from, sel.to)
                        return text.length > 50 ? `"${text.slice(0, 50)}..."` : `"${text}"`
                      }
                      return ''
                    })()}
                  </span>
                  <button
                    onClick={clearSelectionHighlight}
                    className="ms-auto p-1 rounded hover:bg-purple-500/20 transition-colors"
                    title={t('editor.ai_panel.clear_selection')}
                  >
                    <X size={12} className="text-purple-400/60 hover:text-purple-400" />
                  </button>
                </div>
              </motion.div>
            )}

            {/* Block context indicator */}
            {aiEditorState.activeBlockContext && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2 }}
                className="mb-3"
              >
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-violet-500/10 border border-violet-500/20">
                  <Box size={14} className="text-violet-400 flex-shrink-0" />
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-xs font-medium text-violet-300">
                      {aiEditorState.activeBlockContext.label}
                    </span>
                    <span className="text-xs text-violet-300/60">
                      {t('editor.ai_panel.block_selected')}
                    </span>
                  </div>
                  <button
                    onClick={clearSelectionHighlight}
                    className="ms-auto p-1 rounded hover:bg-violet-500/20 transition-colors"
                    title={t('editor.ai_panel.clear_selection')}
                  >
                    <X size={12} className="text-violet-400/60 hover:text-violet-400" />
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          <div className="flex space-x-2 items-end">
            <div className="shrink-0 pb-1">
              <UserAvatar
                rounded="rounded-lg"
                border="border-2"
                width={32}
                shadow="shadow-none"
              />
            </div>
            <div className="w-full relative">
              <textarea
                onKeyDown={handleKeyDown}
                onChange={handleChange}
                onFocus={handleInputFocus}
                disabled={isInputDisabled}
                value={aiEditorState.chatInputValue}
                placeholder={t('editor.ai_panel.input_placeholder')}
                rows={1}
                className={`${inputClass} resize-none min-h-[38px] max-h-[120px]`}
                style={{ height: 'auto' }}
                onInput={(e) => {
                  const target = e.target as HTMLTextAreaElement
                  target.style.height = 'auto'
                  target.style.height = `${Math.min(target.scrollHeight, 120)}px`
                }}
              />
            </div>
            <div className="pb-1">
              <button
                onClick={() => sendMessage(aiEditorState.chatInputValue)}
                disabled={isInputDisabled || !aiEditorState.chatInputValue.trim()}
                className="p-2 rounded-lg bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <MessageCircle size={18} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  )
}

type AIEditorMessageComponentProps = {
  message: AIMessage
  isAI: boolean
  isStreaming?: boolean
}

function AIEditorMessageComponent({
  message,
  isAI,
  isStreaming = false,
}: AIEditorMessageComponentProps) {
  return (
    <div
      className={`flex space-x-3 w-full antialiased ${
        isAI ? 'items-start' : 'items-start'
      }`}
    >
      <div className="shrink-0 pt-0.5">
        {isAI ? (
          <UserAvatar
            rounded="rounded-lg"
            border="border-2"
            predefined_avatar="ai"
            width={32}
            shadow="shadow-none"
          />
        ) : (
          <UserAvatar
            rounded="rounded-lg"
            border="border-2"
            width={32}
            shadow="shadow-none"
          />
        )}
      </div>
      <div className="flex-1 min-w-0">
        {isAI ? (
          <div className={`w-full ${isStreaming ? 'ai-message-streaming' : ''}`}>
            <AIMarkdownRenderer
              content={message.message}
              isStreaming={isStreaming}
            />
          </div>
        ) : (
          <div className="inline-block bg-white/5 rounded-xl rounded-ss-sm px-3 py-2 max-w-[85%]">
            <p className="text-white/90 text-sm leading-relaxed">
              {message.message}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

const AIEditorSidePanelPlaceholder = (props: { sendMessage: (msg: string) => void }) => {
  const session = useLHSession() as any
  const aiEditorState = useAIEditor() as AIEditorStateTypes
  const { t } = useTranslation()

  const predefinedQuestions = [
    {
      label: t('editor.ai_panel.question_improve'),
      prompt: 'How can I improve this content?',
    },
    {
      label: t('editor.ai_panel.question_add_quiz'),
      prompt: 'Add a quiz to test understanding of this material',
    },
    {
      label: t('editor.ai_panel.question_summary'),
      prompt: 'Add a summary section at the end',
    },
  ]

  if (!aiEditorState.error.isError) {
    return (
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="flex flex-col text-center justify-center">
          <motion.div
            initial={{ y: 20, opacity: 0, filter: 'blur(5px)' }}
            animate={{ y: 0, opacity: 1, filter: 'blur(0px)' }}
            transition={{
              type: 'spring',
              bounce: 0.35,
              duration: 1.7,
              mass: 0.2,
              velocity: 2,
              delay: 0.17,
            }}
          >
            <Image
              width={80}
              className="mx-auto"
              src={learnhouseAI_logo_black}
              alt=""
            />
            <p className="pt-3 text-lg font-semibold text-white/70 flex flex-col justify-center items-center">
              <span className="flex items-center space-x-2">
                <span>{t('common.hello')}</span>
                <UserAvatar
                  rounded="rounded-lg"
                  border="border-2"
                  width={28}
                  shadow="shadow-none"
                />
                <span className="capitalize">
                  {session.data.user.username},
                </span>
              </span>
              <span className="text-white/50 text-sm mt-1">
                {t('editor.ai_panel.how_can_i_help')}
              </span>
            </p>
          </motion.div>
          <motion.div
            initial={{ y: 20, opacity: 0, filter: 'blur(5px)' }}
            animate={{ y: 0, opacity: 1, filter: 'blur(0px)' }}
            transition={{
              type: 'spring',
              bounce: 0.35,
              duration: 1.7,
              mass: 0.2,
              velocity: 2,
              delay: 0.27,
            }}
            className="questions flex flex-col space-y-2 mx-auto pt-6"
          >
            {predefinedQuestions.map((q, idx) => (
              <button
                key={idx}
                onClick={() => props.sendMessage(q.prompt)}
                className="flex items-center justify-center space-x-1.5 bg-white/5 cursor-pointer px-4 py-2 rounded-xl outline outline-1 outline-neutral-100/10 text-xs font-semibold text-white/40 hover:text-white/60 hover:bg-white/10 hover:outline-neutral-200/40 delay-75 ease-linear transition-all"
              >
                <span>{q.label}</span>
              </button>
            ))}
          </motion.div>
        </div>
      </div>
    )
  }
  return null
}

export default AIEditorSidePanel
