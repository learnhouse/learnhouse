// Layout and structure blocks (owner: layout builder). See EDITOR_PLUS_SPEC.md, section B:
// tabs, columns, accordion, timeline, table of contents, key takeaways and
// the checklist (taskList / taskItem).
import i18n from '@/lib/i18n'
import type { PlusExtensionFactory } from '../types'
import { createLayoutNodes, type LayoutLabels } from './layoutNodes'
import './layout.css'

export { layoutSlashItems } from './slashItems'
export { hydrateTableOfContents } from './tocDom'

export const layoutLabels = (): LayoutLabels => ({
  tab: String(i18n.t('activities.tabs.tab', 'Tab')),
  contents: String(i18n.t('activities.table_of_contents.title', 'Contents')),
  keyTakeaways: String(i18n.t('activities.key_takeaways.title', 'Key takeaways')),
})

const activityIdOf = (activity: any): string | null => {
  const id = activity?.activity_uuid ?? activity?.id
  return id === undefined || id === null ? null : String(id)
}

export const layoutExtensions: PlusExtensionFactory = ({ mode, activity }) =>
  createLayoutNodes({ mode, activityId: activityIdOf(activity), labels: layoutLabels })
