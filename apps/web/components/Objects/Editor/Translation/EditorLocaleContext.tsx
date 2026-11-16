'use client'
import React from 'react'
import type { ActivityTranslation } from '@services/courses/translations'

/**
 * Set while the activity editor edits a translation (`?lang=fr`): the editor
 * then joins the locale's room, saves to the translation and shows the
 * source next to it. Null for the source language.
 */
export interface EditorLocaleValue {
  locale: string
  /** The course's source language. */
  sourceLocale: string
  translation: ActivityTranslation
  /** Refetch the translation (name, status, outdated). */
  refresh: () => Promise<unknown>
}

export const EditorLocaleContext = React.createContext<EditorLocaleValue | null>(null)

export function useEditorLocale(): EditorLocaleValue | null {
  return React.useContext(EditorLocaleContext)
}
