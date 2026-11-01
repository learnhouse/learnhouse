'use client'

// OSS stub: Atlas (the dashboard AI agent) requires Enterprise Edition.
// The provider renders its children unchanged and every hook reports
// Atlas as unavailable.

import React from 'react'

export interface AtlasPageContext {
  course_uuid?: string
  course_name?: string
  chapter_id?: number
  chapter_name?: string
  activity_uuid?: string
  activity_name?: string
}

export interface AtlasReference {
  type: 'activity' | 'chapter'
  uuid: string
  name: string
  parent_course_uuid: string
  parent_chapter_id?: number
  parent_chapter_name?: string
  activity_type?: string
}

export interface AtlasMiniContextValue {
  available: boolean
  open: boolean
  setOpen: (_open: boolean) => void
  toggle: () => void
  input: string
  setInput: (_v: string) => void
  appendToInput: (_text: string) => void
  focusInput: () => void
  registerInputRef: (_el: HTMLTextAreaElement | null) => void
  pageContext: AtlasPageContext | null
  setPageContext: (_ctx: AtlasPageContext | null) => void
  attachedReferences: AtlasReference[]
  attachReference: (_ref: AtlasReference) => void
  removeReference: (_uuid: string) => void
  clearReferences: () => void
}

const noop = () => {}

const ATLAS_OFF: AtlasMiniContextValue = {
  available: false,
  open: false,
  setOpen: noop,
  toggle: noop,
  input: '',
  setInput: noop,
  appendToInput: noop,
  focusInput: noop,
  registerInputRef: noop,
  pageContext: null,
  setPageContext: noop,
  attachedReferences: [],
  attachReference: noop,
  removeReference: noop,
  clearReferences: noop,
}

export function useAtlasMini(): AtlasMiniContextValue {
  return ATLAS_OFF
}

export function AtlasMiniProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}

export function useRegisterAtlasPageContext(_ctx: AtlasPageContext | null) {}
