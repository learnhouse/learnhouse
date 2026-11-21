/*
 Attribute specs for Experiences nodes.

 Attrs are stored as plain JSON in the document. The HTML mapping only
 matters for copy/paste between editors: arrays and objects round-trip as a
 JSON data attribute instead of "[object Object]", and `blockId` survives a
 paste so a learner's saved progress follows the block.

 Import these from node files as `../shared/attrs` (no React here).
*/
import type { Attribute } from '@tiptap/core'

function dataName(name: string) {
  return `data-${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`
}

function cloneDefault<T>(value: T): T {
  return value && typeof value === 'object' ? (JSON.parse(JSON.stringify(value)) as T) : value
}

/** Any JSON value (array, object, string, number, boolean). */
export function jsonAttr<T>(name: string, fallback: T): Attribute {
  const attr = dataName(name)
  return {
    default: cloneDefault(fallback),
    parseHTML: (element) => {
      const raw = element.getAttribute(attr)
      if (raw == null) return cloneDefault(fallback)
      try {
        return JSON.parse(raw)
      } catch {
        return typeof fallback === 'string' ? raw : cloneDefault(fallback)
      }
    },
    renderHTML: (attributes) => {
      const value = attributes[name]
      if (value === undefined || value === null) return {}
      return { [attr]: JSON.stringify(value) }
    },
  }
}

/**
 * The block's stable id. Empty by default; the registry fills it on insert
 * and `useEnsureBlockId` fills it for blocks that arrive without one (AI,
 * API, old pastes). parseHTML keeps the pasted id.
 */
export function blockIdAttr(): Attribute {
  return {
    default: '',
    parseHTML: (element) => element.getAttribute('data-block-id') || '',
    renderHTML: (attributes) => (attributes.blockId ? { 'data-block-id': String(attributes.blockId) } : {}),
  }
}
