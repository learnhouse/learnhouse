'use client'
import { AIMessage } from '@components/Objects/Activities/AI/AIActivityAsk'
import React, { createContext, useContext, useReducer } from 'react'
export const AIChatBotContext = createContext(null) as any
export const AIChatBotDispatchContext = createContext(null) as any

export type AIChatBotStateTypes = {
  messages: AIMessage[]
  isModalOpen: boolean
  aichat_uuid: string
  isWaitingForResponse: boolean
  chatInputValue: string
  error: AIError
  // Streaming state
  isStreaming: boolean
  streamingContent: string
  followUpSuggestions: string[]
  isLoadingFollowUps: boolean
  isFullscreen: boolean
  isSidePanelOpen: boolean
}

type AIError = {
  isError: boolean
  status: number
  error_message: string
}

function AIChatBotProvider({ children }: { children: React.ReactNode }) {
  const [aiChatBotState, dispatchAIChatBot] = useReducer(aiChatBotReducer, {
    messages: [] as AIMessage[],
    isModalOpen: false,
    aichat_uuid: null,
    isWaitingForResponse: false,
    chatInputValue: '',
    error: { isError: false, status: 0, error_message: ' ' } as AIError,
    // Streaming state
    isStreaming: false,
    streamingContent: '',
    followUpSuggestions: [] as string[],
    isLoadingFollowUps: false,
    isFullscreen: false,
    isSidePanelOpen: false,
  })
  return (
    <AIChatBotContext.Provider value={aiChatBotState}>
      <AIChatBotDispatchContext.Provider value={dispatchAIChatBot}>
        {children}
      </AIChatBotDispatchContext.Provider>
    </AIChatBotContext.Provider>
  )
}

export default AIChatBotProvider

export function useAIChatBot() {
  return useContext(AIChatBotContext)
}

export function useAIChatBotDispatch() {
  return useContext(AIChatBotDispatchContext)
}

function aiChatBotReducer(state: any, action: any) {
  switch (action.type) {
    case 'setMessages':
      return { ...state, messages: action.payload }
    case 'addMessage':
      return { ...state, messages: [...state.messages, action.payload] }
    case 'setIsModalOpen':
      return { ...state, isModalOpen: true }
    case 'setIsModalClose':
      return { ...state, isModalOpen: false }
    case 'setAichat_uuid':
      return { ...state, aichat_uuid: action.payload }
    case 'setIsWaitingForResponse':
      return { ...state, isWaitingForResponse: true }
    case 'setIsNoLongerWaitingForResponse':
      return { ...state, isWaitingForResponse: false }
    case 'setChatInputValue':
      return { ...state, chatInputValue: action.payload }
    case 'setError':
      return { ...state, error: action.payload }
    // Streaming actions
    case 'setIsStreaming':
      return { ...state, isStreaming: true, streamingContent: '' }
    case 'setStreamingComplete':
      return { ...state, isStreaming: false }
    case 'appendStreamingContent':
      return { ...state, streamingContent: state.streamingContent + action.payload }
    case 'clearStreamingContent':
      return { ...state, streamingContent: '' }
    case 'setFollowUpSuggestions':
      return { ...state, followUpSuggestions: action.payload, isLoadingFollowUps: false }
    case 'clearFollowUpSuggestions':
      return { ...state, followUpSuggestions: [] }
    case 'setIsLoadingFollowUps':
      return { ...state, isLoadingFollowUps: true }
    case 'setIsNotLoadingFollowUps':
      return { ...state, isLoadingFollowUps: false }
    // Fullscreen
    case 'toggleFullscreen':
      return { ...state, isFullscreen: !state.isFullscreen }
    case 'setFullscreen':
      return { ...state, isFullscreen: action.payload }
    // Side Panel
    case 'setSidePanelOpen':
      return { ...state, isSidePanelOpen: true, isModalOpen: false, isFullscreen: false }
    case 'setSidePanelClose':
      return { ...state, isSidePanelOpen: false }
    // Mode switching - atomic actions
    case 'switchToHoverMode':
      return { ...state, isSidePanelOpen: false, isModalOpen: true }
    case 'switchToSideMode':
      return { ...state, isSidePanelOpen: true, isModalOpen: false, isFullscreen: false }

    default:
      throw new Error(`Unhandled action type: ${action.type}`)
  }
}
