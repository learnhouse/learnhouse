'use client'
import React, { useState } from 'react'

export const EditorProviderContext = React.createContext(null) as any

type EditorProviderProps = {
  children: React.ReactNode
  options: EditorProviderState
}

type EditorProviderState = {
  isEditable: boolean
}

function EditorOptionsProvider({ children, options }: EditorProviderProps) {
  const [editorOptions, setEditorOptions] =
    useState<EditorProviderState>(options)

  return (
    <EditorProviderContext.Provider value={editorOptions}>
      {children}
    </EditorProviderContext.Provider>
  )
}

export default EditorOptionsProvider

export function useEditorProvider() {
  return React.useContext(EditorProviderContext)
}
