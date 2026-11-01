import type { ComponentType } from 'react'

/**
 * A learner-facing page the command palette can jump to.
 *
 * Mirrors the dashboard's `SearchMeta`, minus the dashboard-only grouping:
 * the title, a one-line description and a list of keywords, all translated,
 * are what the palette matches the query against.
 */
export interface SitePageMeta {
  id: string
  titleKey: string
  descriptionKey?: string
  keywordsKey?: string
  icon: ComponentType<any>
  /** Org-relative path; the palette resolves it with `getUriWithOrg`. */
  href: string
  /** `resolved_features` key that has to be enabled for the page to exist. */
  featureKey?: string
  /** Builtin menu item type, so an org that hid the entry in its menu config hides it here too. */
  menuType?: string
  /** Only offered to signed-in users. */
  requiresAuth?: boolean
  /** Copilot has an extra admin toggle on top of the `ai` feature. */
  requiresCopilot?: boolean
  /** Keyboard chord that jumps here, e.g. `g c`; shown as a hint wherever the page is linked. */
  shortcut?: string
}
