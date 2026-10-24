import { FolderSimple } from '@phosphor-icons/react'
import type { SitePageMeta } from '@/lib/site-search/types'

export const sitePage: SitePageMeta = {
  id: 'site.library',
  titleKey: 'library.library',
  descriptionKey: 'search.palette.entries.library.description',
  keywordsKey: 'search.palette.entries.library.keywords',
  icon: FolderSimple,
  href: '/library',
  shortcut: 'g l',
  featureKey: 'folders',
  menuType: 'library',
}
