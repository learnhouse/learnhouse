'use client'
import { AIMessage } from '@components/Objects/Activities/AI/AIActivityAsk'
import React, { createContext, useContext, useReducer } from 'react'
export const AIEditorContext = createContext(null) as any
export const AIEditorDispatchContext = createContext(null) as any

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

    default:
      throw new Error(`Unhandled action type: ${action.type}`)
  }
}
