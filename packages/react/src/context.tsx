import { createContext, useContext } from 'react'
import type { LearnHouseEvent } from './types'
import type { UseSessionReturn } from './shims/auth-context'

export interface LearnHouseInternal {
  client: any | null
  baseUrl: string
  session: UseSessionReturn
  emit: (event: LearnHouseEvent) => void
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
})

export const useLearnHouseInternal = () => useContext(LearnHouseInternalContext)
