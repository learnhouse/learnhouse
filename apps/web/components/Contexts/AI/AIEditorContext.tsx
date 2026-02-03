'use client'
import { AIMessage } from '@components/Objects/Activities/AI/AIActivityAsk'
import React, { createContext, useContext, useReducer } from 'react'
export const AIEditorContext = createContext(null) as any
export const AIEditorDispatchContext = createContext(null) as any

export type PendingModification = {
  action: 'replace' | 'insert' | 'append'
  targetText: string
  newContent: string
  status: 'preview' | 'applied' | 'streaming'
} | null

export type SelectionRange = {
  from: number
  to: number
} | null

export type BlockContext = {
  type: string
  from: number
  to: number
  label: string
} | null

export type AIEditorStateTypes = {
  messages: AIMessage[]
  isModalOpen: boolean
  isFeedbackModalOpen: boolean
  aichat_uuid: string
  isWaitingForResponse: boolean
  chatInputValue: string
  selectedTool:
    | 'Writer'
    | 'ContinueWriting'
    | 'MakeLonger'
    | 'GenerateQuiz'
    | 'Translate'
  isUserInputEnabled: boolean
  error: AIError
  // Side panel state
  isSidePanelOpen: boolean
  isStreaming: boolean
  streamingContent: string
  currentEditorContent: any // TipTap JSON snapshot
  pendingModification: PendingModification
  followUpSuggestions: string[]
  isLoadingFollowUps: boolean
  // Persistent selection highlight
  persistentSelection: SelectionRange
  // Block context (when cursor is inside a block)
  activeBlockContext: BlockContext
}

type AIError = {
  isError: boolean
  status: number
  error_message: string
}

function AIEditorProvider({ children }: { children: React.ReactNode }) {
  const [aIEditorState, dispatchAIEditor] = useReducer(aIEditorReducer, {
    messages: [] as AIMessage[],
    isModalOpen: false,
    isFeedbackModalOpen: false,
    aichat_uuid: null,
    isWaitingForResponse: false,
    chatInputValue: '',
    selectedTool: 'Writer',
    isUserInputEnabled: true,
    error: { isError: false, status: 0, error_message: ' ' } as AIError,
    // Side panel initial state
    isSidePanelOpen: false,
    isStreaming: false,
    streamingContent: '',
    currentEditorContent: null,
    pendingModification: null,
    followUpSuggestions: [],
    isLoadingFollowUps: false,
    // Persistent selection highlight
    persistentSelection: null,
    // Block context
    activeBlockContext: null,
  })
  return (
    <AIEditorContext.Provider value={aIEditorState}>
      <AIEditorDispatchContext.Provider value={dispatchAIEditor}>
        {children}
      </AIEditorDispatchContext.Provider>
    </AIEditorContext.Provider>
  )
}

export default AIEditorProvider

export function useAIEditor() {
  return useContext(AIEditorContext)
}

export function useAIEditorDispatch() {
  return useContext(AIEditorDispatchContext)
}

function aIEditorReducer(state: any, action: any) {
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
    case 'setSelectedTool':
      return { ...state, selectedTool: action.payload }
    case 'setIsFeedbackModalOpen':
      return { ...state, isFeedbackModalOpen: true }
    case 'setIsFeedbackModalClose':
      return { ...state, isFeedbackModalOpen: false }
    case 'setIsUserInputEnabled':
      return { ...state, isUserInputEnabled: action.payload }
    case 'setError':
      return { ...state, error: action.payload }
    // Side panel actions
    case 'setSidePanelOpen':
      return { ...state, isSidePanelOpen: true }
    case 'setSidePanelClose':
      return { ...state, isSidePanelOpen: false }
    case 'toggleSidePanel':
      return { ...state, isSidePanelOpen: !state.isSidePanelOpen }
    case 'setIsStreaming':
      return { ...state, isStreaming: true }
    case 'setStreamingComplete':
      return { ...state, isStreaming: false }
    case 'appendStreamingContent':
      return { ...state, streamingContent: state.streamingContent + action.payload }
    case 'clearStreamingContent':
      return { ...state, streamingContent: '' }
    case 'setCurrentEditorContent':
      return { ...state, currentEditorContent: action.payload }
    case 'setPendingModification':
      return { ...state, pendingModification: action.payload }
    case 'clearPendingModification':
      return { ...state, pendingModification: null }
    case 'setFollowUpSuggestions':
      return { ...state, followUpSuggestions: action.payload, isLoadingFollowUps: false }
    case 'clearFollowUpSuggestions':
      return { ...state, followUpSuggestions: [], isLoadingFollowUps: false }
    case 'setIsLoadingFollowUps':
      return { ...state, isLoadingFollowUps: true }
    case 'setIsNotLoadingFollowUps':
      return { ...state, isLoadingFollowUps: false }
    case 'resetSidePanelState':
      return {
        ...state,
        messages: [],
        aichat_uuid: null,
        isStreaming: false,
        streamingContent: '',
        pendingModification: null,
        followUpSuggestions: [],
        isLoadingFollowUps: false,
        error: { isError: false, status: 0, error_message: '' },
        persistentSelection: null,
        activeBlockContext: null,
      }
    // Persistent selection actions
    case 'setPersistentSelection':
      return { ...state, persistentSelection: action.payload }
    case 'clearPersistentSelection':
      return { ...state, persistentSelection: null }
    // Block context actions
    case 'setActiveBlockContext':
      return { ...state, activeBlockContext: action.payload }
    case 'clearActiveBlockContext':
      return { ...state, activeBlockContext: null }

    default:
      throw new Error(`Unhandled action type: ${action.type}`)
  }
}
