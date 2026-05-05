import type { ComponentType } from 'react'

export type SearchMetaGroup =
  | 'home'
  | 'navigation'
  | 'content'
  | 'users'
  | 'settings'
  | 'analytics'
  | 'payments'

// Loose so we can use Phosphor, Lucide, or any custom React icon component
// without coupling to a specific icon family's prop types.
export type SearchMetaIcon = ComponentType<any>

export interface SearchMeta {
  id: string
  titleKey: string
  descriptionKey?: string
  keywordsKey?: string
  icon: SearchMetaIcon
  href: string
  group: SearchMetaGroup
  featureKey?: string
  featureDefaultDisabled?: boolean
  requiresOrgAdmin?: boolean
}
