'use client'
import React from 'react'
import type { LandingDoc, LandingNode } from '../model/types'

export type RenderMode = 'public' | 'canvas' | 'thumbnail'

export interface RenderLabels {
  courses_empty: string
  sign_in: string
  loading: string
  view_course: string
  start_learning: string
  lessons: string
  subscribe_success: string
  form_success: string
  form_error: string
  sending: string
  menu: string
  placeholder_image: string
  placeholder_embed: string
  placeholder_newsletter: string
  placeholder_newsletter_form: string
  placeholder_course: string
  placeholder_data: string
  countdown: [string, string, string, string]
  pricing_from: string
  pricing_month: string
  pricing_year: string
  pricing_subscription: string
  custom_code: string
  required: string
}

export interface RenderContextValue {
  mode: RenderMode
  doc: LandingDoc
  orgslug: string
  org: any
  /** Visitor session status (public mode filters on it). */
  session: 'loading' | 'authenticated' | 'unauthenticated'
  accessToken?: string
  /** Page slug, for form submissions ("" = home). */
  pageSlug: string
  labels: RenderLabels
  /** Canvas only: the element whose text is being edited in place. */
  editingId?: string | null
  onTextCommit?: (id: string, field: string, value: string) => void
  onTextCancel?: () => void
}

export const RenderContext = React.createContext<RenderContextValue | null>(null)

export function useRender(): RenderContextValue {
  const ctx = React.useContext(RenderContext)
  if (!ctx) throw new Error('LandingPages: missing RenderContext')
  return ctx
}

/** What each element puts on its root DOM node. */
export function rootProps(node: LandingNode, mode: RenderMode, extraClass = ''): Record<string, any> {
  const props: Record<string, any> = { className: `lhp-${node.id}${extraClass ? ` ${extraClass}` : ''}` }
  if (node.anchor) props.id = node.anchor
  if (node.animation && node.animation.type !== 'none' && mode === 'public') {
    props['data-anim'] = node.animation.type
    props.style = { animationDelay: `${node.animation.delay || 0}ms`, animationDuration: `${node.animation.duration || 600}ms` }
  }
  if (mode === 'canvas') {
    props['data-lhp-id'] = node.id
    props['data-lhp-type'] = node.type
  }
  return props
}
