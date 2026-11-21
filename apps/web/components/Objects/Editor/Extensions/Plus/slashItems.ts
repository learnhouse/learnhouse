// The Editor Plus slash menu items. Editor only: kept out of ./index (which
// the learner renderer imports) so the menu's code never ships to learners.
import { tableTemplateItems } from './tables/templates'
import { layoutSlashItems } from './layout/slashItems'
import { mediaSlashItems } from './media/slashItems'
import { upgradesSlashItems } from './upgrades/slashItems'
import type { SlashCommandItem } from './types'

export const plusSlashItems: SlashCommandItem[] = [
  ...tableTemplateItems,
  ...layoutSlashItems,
  ...mediaSlashItems,
  ...upgradesSlashItems,
]
