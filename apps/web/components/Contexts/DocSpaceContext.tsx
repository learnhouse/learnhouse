'use client'
import React, { createContext, useContext, useReducer, useEffect, useCallback, useRef } from 'react'
import useSWR from 'swr'
import { getAPIUrl } from '@services/config/config'
import { swrFetcher } from '@services/utils/ts/requests'
import { useLHSession } from './LHSessionContext'
import { updateDocSpace } from '@services/docs/docspaces'
import toast from 'react-hot-toast'

interface DocSpaceState {
  docSpaceStructure: any | null
  isLoading: boolean
  isSaving: boolean
  isSaved: boolean
  saveError: string | null
}

type DocSpaceAction =
  | { type: 'SET_STRUCTURE'; payload: any }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_SAVING'; payload: boolean }
  | { type: 'SET_SAVED'; payload: boolean }
  | { type: 'MERGE_CHANGES'; payload: any }
  | { type: 'SET_IS_NOT_SAVED' }
  | { type: 'SET_SAVE_ERROR'; payload: string | null }

const DocSpaceContext = createContext<DocSpaceState | null>(null)
const DocSpaceDispatchContext = createContext<React.Dispatch<DocSpaceAction> | null>(null)

function docSpaceReducer(state: DocSpaceState, action: DocSpaceAction): DocSpaceState {
  switch (action.type) {
    case 'SET_STRUCTURE':
      return { ...state, docSpaceStructure: action.payload, isLoading: false }
    case 'SET_LOADING':
      return { ...state, isLoading: action.payload }
    case 'SET_SAVING':
      return { ...state, isSaving: action.payload }
    case 'SET_SAVED':
      return { ...state, isSaved: true, saveError: null }
    case 'SET_IS_NOT_SAVED':
      return { ...state, isSaved: false }
    case 'SET_SAVE_ERROR':
      return { ...state, saveError: action.payload }
    case 'MERGE_CHANGES':
      return {
        ...state,
        docSpaceStructure: { ...state.docSpaceStructure, ...action.payload },
        isSaved: false,
      }
    default:
      return state
  }
}

export function DocSpaceProvider({
  children,
  docspaceUUID,
}: {
  children: React.ReactNode
  docspaceUUID: string
}) {
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token

  const [state, dispatch] = useReducer(docSpaceReducer, {
    docSpaceStructure: null,
    isLoading: true,
    isSaving: false,
    isSaved: true,
    saveError: null,
  })

  const { data, error, isLoading } = useSWR(
    docspaceUUID && access_token
      ? `${getAPIUrl()}docs/${docspaceUUID}/meta`
      : null,
    (url: string) => swrFetcher(url, access_token),
    {
      revalidateOnFocus: true,
    }
  )

  useEffect(() => {
    if (data) {
      dispatch({ type: 'SET_STRUCTURE', payload: data })
    }
  }, [data])

  useEffect(() => {
    dispatch({ type: 'SET_LOADING', payload: isLoading })
  }, [isLoading])

  return (
    <DocSpaceContext.Provider value={state}>
      <DocSpaceDispatchContext.Provider value={dispatch}>
        {children}
      </DocSpaceDispatchContext.Provider>
    </DocSpaceContext.Provider>
  )
}

export function useDocSpace() {
  const context = useContext(DocSpaceContext)
  if (!context) {
    throw new Error('useDocSpace must be used within a DocSpaceProvider')
  }
  return context
}

export function useDocSpaceDispatch() {
  const context = useContext(DocSpaceDispatchContext)
  if (!context) {
    throw new Error('useDocSpaceDispatch must be used within a DocSpaceProvider')
  }
  return context
}

export function useDocSpaceFieldSync() {
  const { docSpaceStructure, isLoading, isSaving, isSaved } = useDocSpace()
  const dispatch = useDocSpaceDispatch()
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const syncChanges = useCallback((changes: Record<string, any>) => {
    dispatch({ type: 'MERGE_CHANGES', payload: changes })
  }, [dispatch])

  const cancelPendingSync = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
  }, [])

  return {
    docSpaceStructure,
    isLoading,
    isSaving,
    isSaved,
    syncChanges,
    cancelPendingSync,
    dispatch,
  }
}
