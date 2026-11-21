// Media and data blocks (owner: media builder). See EDITOR_PLUS_SPEC.md, section C:
// gallery, image compare, chart, stat highlights, file card and quote.
import i18n from '@/lib/i18n'
import type { PlusExtensionFactory } from '../types'
import { createMediaNodes } from './mediaNodes'
import { mediaLabels } from './labels'
import './media.css'

// Slash items: ./slashItems (editor only, gathered in ../slashItems).

const t = (key: string, fallback: string, vars?: Record<string, unknown>) => String(i18n.t(key, { defaultValue: fallback, ...(vars ?? {}) }))

export const mediaExtensions: PlusExtensionFactory = ({ mode, activity }) => createMediaNodes({ mode, activity, labels: () => mediaLabels(t, i18n.language) })
