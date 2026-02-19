'use client'

import { createContext, useContext } from 'react'
import type * as Y from 'yjs'

const BoardYjsContext = createContext<Y.Doc | null>(null)

export const BoardYjsProvider = BoardYjsContext.Provider

export function useBoardYdoc(): Y.Doc | null {
  return useContext(BoardYjsContext)
}
