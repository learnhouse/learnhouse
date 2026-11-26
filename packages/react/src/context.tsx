import { createContext, useContext } from 'react'
import type { TrailStore } from '@learnhouse/sdk'
import type { LearnHouseEvent } from './types'
import type { UseSessionReturn } from './shims/auth-context'

export interface LearnHouseInternal {
  client: any | null
  baseUrl: string
  session: UseSessionReturn
  emit: (event: LearnHouseEvent) => void
  /** A valid access token (refreshing the session first if needed), or null. */
  getAccessToken: () => Promise<string | null>
  /** The learner's trail per org, shared by progress hooks and completion buttons. */
  trailStore: TrailStore | null
}

const anonymous: UseSessionReturn = {
  data: null,
  status: 'unauthenticated',
  update: async () => {},
}

export const LearnHouseInternalContext = createContext<LearnHouseInternal>({
  client: null,
  baseUrl: '',
  session: anonymous,
  emit: () => {},
  getAccessToken: async () => null,
  trailStore: null,
})

export const useLearnHouseInternal = () => useContext(LearnHouseInternalContext)
