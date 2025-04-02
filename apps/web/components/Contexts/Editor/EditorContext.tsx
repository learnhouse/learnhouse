'use client'
import type { ReactNode } from 'react'
import { createContext, use, useState } from 'react'

export const EditorProviderContext = createContext(null) as any

type EditorProviderProps = {
  children: ReactNode
  options: EditorProviderState
}

type EditorProviderState = {
  isEditable: boolean
}

function EditorOptionsProvider({ children, options }: EditorProviderProps) {
  const [editorOptions, setEditorOptions] =
    useState<EditorProviderState>(options)

  return (
    <EditorProviderContext value={editorOptions}>
      {children}
    </EditorProviderContext>
  )
}

export default EditorOptionsProvider

export function useEditorProvider() {
  return use(EditorProviderContext)
}
