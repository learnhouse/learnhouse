'use client'
import type { AIMessage } from '@components/Objects/Activities/AI/AIActivityAsk'
import type React from 'react'
import { createContext, use, useReducer } from 'react'
export const AIChatBotContext = createContext(null) as any
export const AIChatBotDispatchContext = createContext(null) as any

export type AIChatBotStateTypes = {
  messages: AIMessage[]
  isModalOpen: boolean
  aichat_uuid: string
  isWaitingForResponse: boolean
  chatInputValue: string
  error: AIError
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
  })
  return (
    <AIChatBotContext value={aiChatBotState}>
      <AIChatBotDispatchContext value={dispatchAIChatBot}>
        {children}
      </AIChatBotDispatchContext>
    </AIChatBotContext>
  )
}

export default AIChatBotProvider

export function useAIChatBot() {
  return use(AIChatBotContext)
}

export function useAIChatBotDispatch() {
  return use(AIChatBotDispatchContext)
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

    default:
      throw new Error(`Unhandled action type: ${action.type}`)
  }
}
