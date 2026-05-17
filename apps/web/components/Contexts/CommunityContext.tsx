'use client'
import React, { createContext, useContext, useEffect, useReducer } from 'react'
import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { Community, getCommunity } from '@services/communities/communities'

interface CommunityState {
  community: Community | null
  isLoading: boolean
  isSaved: boolean
}

type CommunityAction =
  | { type: 'setCommunity'; payload: Community }
  | { type: 'setIsLoaded' }
  | { type: 'setIsSaved' }
  | { type: 'setIsNotSaved' }

export const CommunityContext = createContext<CommunityState | null>(null)
export const CommunityDispatchContext = createContext<React.Dispatch<CommunityAction> | null>(null)

interface CommunityProviderProps {
  children: React.ReactNode
  communityuuid: string
}

export function CommunityProvider({ children, communityuuid }: CommunityProviderProps) {
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token

  // Add community_ prefix if not present
  const fullCommunityUuid = communityuuid.startsWith('community_')
    ? communityuuid
    : `community_${communityuuid}`

  const { data: communityData, error } = useQuery({
    queryKey: queryKeys.community.detail(fullCommunityUuid),
    queryFn: () => getCommunity(fullCommunityUuid, null, access_token),
    staleTime: 60_000,
    enabled: !!(fullCommunityUuid && access_token),
  })

  const initialState: CommunityState = {
    community: null,
    isLoading: true,
    isSaved: true,
  }

  const [state, dispatch] = useReducer(communityReducer, initialState)

  useEffect(() => {
    if (communityData) {
      dispatch({ type: 'setCommunity', payload: communityData })
      dispatch({ type: 'setIsLoaded' })
    }
  }, [communityData])

  if (error) return <div>Failed to load community</div>
  if (!communityData) return null

  return (
    <CommunityContext.Provider value={state}>
      <CommunityDispatchContext.Provider value={dispatch}>
        {children}
      </CommunityDispatchContext.Provider>
    </CommunityContext.Provider>
  )
}

export function useCommunity() {
  return useContext(CommunityContext)
}

export function useCommunityDispatch() {
  return useContext(CommunityDispatchContext)
}

function communityReducer(state: CommunityState, action: CommunityAction): CommunityState {
  switch (action.type) {
    case 'setCommunity':
      return { ...state, community: action.payload }
    case 'setIsLoaded':
      return { ...state, isLoading: false }
    case 'setIsSaved':
      return { ...state, isSaved: true }
    case 'setIsNotSaved':
      return { ...state, isSaved: false }
    default:
      throw new Error(`Unhandled action type`)
  }
}
