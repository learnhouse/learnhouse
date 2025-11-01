import React, { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Editor } from '@tiptap/core'
import learnhouseAI_icon from 'public/learnhouse_ai_simple.png'
import Image from 'next/image'
import { BookOpen, FormInput, Languages, MoreVertical, X } from 'lucide-react'
import ToolTip from '@components/Objects/StyledElements/Tooltip/Tooltip'
import {
  AIChatBotStateTypes,
  useAIChatBot,
  useAIChatBotDispatch,
} from '@components/Contexts/AI/AIChatBotContext'
import {
  sendActivityAIChatMessage,
  startActivityAIChatSession,
} from '@services/ai/ai'
import useGetAIFeatures from '../../../../Hooks/useGetAIFeatures'
import { useLHSession } from '@components/Contexts/LHSessionContext'

type AICanvaToolkitProps = {
  editor: Editor
  activity: any
}

function AICanvaToolkit(props: AICanvaToolkitProps) {
  const is_ai_feature_enabled = useGetAIFeatures({ feature: 'activity_ask' })
  const [bubbleState, setBubbleState] = useState({
    visible: false,
    top: 0,
    left: 0,
  })

  const updateBubblePosition = useCallback(() => {
    if (!props.editor) return

    const { selection } = props.editor.state
    const { from, to } = selection

    // Hide if no selection
    if (from === to) {
      setBubbleState(prev => ({ ...prev, visible: false }))
      return
    }

    // Get selection bounds using native selection API
    const nativeSelection = window.getSelection()
    if (!nativeSelection || nativeSelection.rangeCount === 0) {
      setBubbleState(prev => ({ ...prev, visible: false }))
      return
    }

    const range = nativeSelection.getRangeAt(0)
    const rect = range.getBoundingClientRect()

    // Calculate position - always above the selection
    const bubbleHeight = 50
    const bubbleWidth = 350
    
    // Position above selection with margin
    const top = rect.top + window.scrollY - bubbleHeight - 2
    
    // Center horizontally on selection
    const centerX = rect.left + rect.width / 2
    const left = centerX - bubbleWidth / 2

    // Keep within viewport bounds
    const adjustedLeft = Math.max(10, Math.min(left, window.innerWidth - bubbleWidth - 10))
    const adjustedTop = Math.max(10, top)

    setBubbleState({
      visible: true,
      top: adjustedTop,
      left: adjustedLeft,
    })
  }, [props.editor])

  useEffect(() => {
    if (!props.editor || !is_ai_feature_enabled) return

    const handleSelectionUpdate = () => {
      // Small delay to ensure DOM is updated
      requestAnimationFrame(() => {
        updateBubblePosition()
      })
    }

    const handleScroll = () => {
      updateBubblePosition()
    }

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Element
      const bubbleElement = document.getElementById('ai-bubble-portal')
      const editorElement = props.editor.view.dom

      if (
        !editorElement.contains(target) &&
        !bubbleElement?.contains(target)
      ) {
        setBubbleState(prev => ({ ...prev, visible: false }))
      }
    }

    // Listen to editor events
    props.editor.on('selectionUpdate', handleSelectionUpdate)
    
    // Listen to scroll and click events
    window.addEventListener('scroll', handleScroll, true)
    document.addEventListener('mousedown', handleClickOutside)

    return () => {
      props.editor.off('selectionUpdate', handleSelectionUpdate)
      window.removeEventListener('scroll', handleScroll, true)
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [props.editor, is_ai_feature_enabled, updateBubblePosition])

  if (!is_ai_feature_enabled || !bubbleState.visible) {
    return null
  }

  const bubbleContent = (
    <div
      id="ai-bubble-portal"
      style={{
        position: 'fixed',
        top: `${bubbleState.top}px`,
        left: `${bubbleState.left}px`,
        zIndex: 9999,
        pointerEvents: 'auto',
      }}
    >
      <div
        style={{
          background:
            'linear-gradient(0deg, rgba(0, 0, 0, 0.2) 0%, rgba(0, 0, 0, 0.2) 100%), radial-gradient(105.16% 105.16% at 50% -5.16%, rgba(255, 255, 255, 0.18) 0%, rgba(0, 0, 0, 0) 100%), rgba(2, 1, 25, 0.98)',
        }}
        className="py-1 h-10 px-2 w-max text-white rounded-xl shadow-md cursor-pointer flex items-center space-x-2 antialiased animate-in fade-in-0 zoom-in-95 duration-200"
      >
        <div className="flex w-full space-x-2 font-bold text-white/80">
          <Image
            className="outline-1 outline-neutral-200/10 rounded-lg"
            width={24}
            src={learnhouseAI_icon}
            alt=""
          />
          <div>AI</div>
        </div>
        <div>
          <MoreVertical className="text-white/50" size={12} />
        </div>
        <div className="flex space-x-2">
          <AIActionButton
            editor={props.editor}
            activity={props.activity}
            label="Explain"
          />
          <AIActionButton
            editor={props.editor}
            activity={props.activity}
            label="Summarize"
          />
          <AIActionButton
            editor={props.editor}
            activity={props.activity}
            label="Translate"
          />
          <AIActionButton
            editor={props.editor}
            activity={props.activity}
            label="Examples"
          />
        </div>
      </div>
    </div>
  )

  // Render using portal to document.body
  return typeof window !== 'undefined' ? createPortal(bubbleContent, document.body) : null
}

function AIActionButton(props: {
  editor: Editor
  label: string
  activity: any
}) {
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token;
  const dispatchAIChatBot = useAIChatBotDispatch() as any
  const aiChatBotState = useAIChatBot() as AIChatBotStateTypes

  async function handleAction(label: string) {
    const selection = getTipTapEditorSelectedText()
    const prompt = getPrompt(label, selection)
    dispatchAIChatBot({ type: 'setIsModalOpen' })
    await sendMessage(prompt)
  }

  const getTipTapEditorSelectedText = () => {
    const selection = props.editor.state.selection
    const from = selection.from
    const to = selection.to
    const text = props.editor.state.doc.textBetween(from, to)
    return text
  }

  const getPrompt = (label: string, selection: string) => {
    if (label === 'Explain') {
      return `Explain this part of the course "${selection}" keep this course context in mind.`
    } else if (label === 'Summarize') {
      return `Summarize this "${selection}" with the course context in mind.`
    } else if (label === 'Translate') {
      return `Translate "${selection}" to another language.`
    } else {
      return `Give examples to understand "${selection}" better, if possible give context in the course.`
    }
  }

  const sendMessage = async (message: string) => {
    if (aiChatBotState.aichat_uuid) {
      await dispatchAIChatBot({
        type: 'addMessage',
        payload: { sender: 'user', message: message, type: 'user' },
      })
      await dispatchAIChatBot({ type: 'setIsWaitingForResponse' })
      const response = await sendActivityAIChatMessage(
        message,
        aiChatBotState.aichat_uuid,
        props.activity.activity_uuid, access_token
      )
      if (response.success == false) {
        await dispatchAIChatBot({ type: 'setIsNoLongerWaitingForResponse' })
        await dispatchAIChatBot({ type: 'setChatInputValue', payload: '' })
        await dispatchAIChatBot({
          type: 'setError',
          payload: {
            isError: true,
            status: response.status,
            error_message: response.data.detail,
          },
        })
        return
      }
      await dispatchAIChatBot({ type: 'setIsNoLongerWaitingForResponse' })
      await dispatchAIChatBot({ type: 'setChatInputValue', payload: '' })
      await dispatchAIChatBot({
        type: 'addMessage',
        payload: { sender: 'ai', message: response.data.message, type: 'ai' },
      })
    } else {
      await dispatchAIChatBot({
        type: 'addMessage',
        payload: { sender: 'user', message: message, type: 'user' },
      })
      await dispatchAIChatBot({ type: 'setIsWaitingForResponse' })
      const response = await startActivityAIChatSession(
        message,
        access_token,
        props.activity.activity_uuid
      )
      if (response.success == false) {
        await dispatchAIChatBot({ type: 'setIsNoLongerWaitingForResponse' })
        await dispatchAIChatBot({ type: 'setChatInputValue', payload: '' })
        await dispatchAIChatBot({
          type: 'setError',
          payload: {
            isError: true,
            status: response.status,
            error_message: response.data.detail,
          },
        })
        return
      }
      await dispatchAIChatBot({
        type: 'setAichat_uuid',
        payload: response.data.aichat_uuid,
      })
      await dispatchAIChatBot({ type: 'setIsNoLongerWaitingForResponse' })
      await dispatchAIChatBot({ type: 'setChatInputValue', payload: '' })
      await dispatchAIChatBot({
        type: 'addMessage',
        payload: { sender: 'ai', message: response.data.message, type: 'ai' },
      })
    }
  }

  const tooltipLabel =
    props.label === 'Explain'
      ? 'Explain a word or a sentence with AI'
      : props.label === 'Summarize'
        ? 'Summarize a long paragraph or text with AI'
        : props.label === 'Translate'
          ? 'Translate to different languages with AI'
          : 'Give examples to understand better with AI'
  return (
    <div className="flex space-x-2">
      <ToolTip sideOffset={10} slateBlack content={tooltipLabel}>
        <button
          onClick={() => handleAction(props.label)}
          className="flex space-x-1.5 items-center bg-white/10 px-2 py-0.5 rounded-md outline-1 outline-neutral-200/20 text-sm font-semibold text-white/70 hover:bg-white/20 hover:outline-neutral-200/40 delay-75 ease-linear transition-all"
        >
          {props.label === 'Explain' && <BookOpen size={16} />}
          {props.label === 'Summarize' && <FormInput size={16} />}
          {props.label === 'Translate' && <Languages size={16} />}
          {props.label === 'Examples' && (
            <div className="text-white/50">Ex</div>
          )}
          <div>{props.label}</div>
        </button>
      </ToolTip>
    </div>
  )
}

export default AICanvaToolkit
