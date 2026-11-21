// Upgrades to existing blocks (owner: upgrades builder). See EDITOR_PLUS_SPEC.md, section D.
// New schema pieces live here (button group, inline math, text alignment);
// the upgrades of quiz, callout, toggle, code, button and image live in
// those blocks' own folders and share upgrades.css for their new looks.
import type { PlusExtensionFactory } from '../types'
import { createUpgradeNodes } from './upgradeNodes'
import './upgrades.css'

export { upgradesSlashItems } from './slashItems'

export const upgradesExtensions: PlusExtensionFactory = (ctx) => createUpgradeNodes(ctx)
