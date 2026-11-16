import { ReactNodeViewRenderer } from '@tiptap/react'
import type { ReactNodeViewRendererOptions } from '@tiptap/react'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { ComponentType } from 'react'
import { resolveVideoBlockObject, VIDEO_SIZES, type VideoSize } from '../Blocks/schema/blockAttrs'

/**
 * Space a media block takes before its React view has rendered.
 *
 * A block's view mounts after the lesson text (its code is a separate chunk),
 * so an empty wrapper used to collapse to nothing and the block then pushed
 * everything below it down: most of the lesson page's layout shift. The
 * wrapper carries the block's known size (from its attributes) as CSS
 * variables; styles/globals.css applies them only while the wrapper is
 * `:empty`, so a rendered block always sizes itself.
 */
export function reservedSpaceAttrs(node: PMNode): Record<string, string> {
  const attrs = node.attrs || {}
  switch (node.type.name) {
    case 'blockVideo': {
      const block = resolveVideoBlockObject(attrs.blockObject)
      if (!block?.content?.file_id) return {}
      const width = VIDEO_SIZES[(block.size as VideoSize) || 'medium']?.width ?? VIDEO_SIZES.medium.width
      return { 'data-lh-reserve': 'ratio', style: `--lh-reserve-max:${width}px;--lh-reserve-ratio:16/9` }
    }
    case 'blockEmbed': {
      if (!attrs.embedUrl && !attrs.embedCode) return {}
      const ratio = Number(attrs.embedAspectRatio)
      if (ratio > 0) return { 'data-lh-reserve': 'ratio', style: `--lh-reserve-max:100%;--lh-reserve-ratio:${ratio}` }
      const height = parseInt(String(attrs.embedHeight || 300), 10)
      return height > 0 ? { 'data-lh-reserve': 'height', style: `--lh-reserve-h:${height}px` } : {}
    }
    case 'blockPDF': {
      if (!attrs.blockObject) return {}
      const height = parseInt(String(attrs.pdfHeight || ''), 10)
      return { 'data-lh-reserve': 'height', style: `--lh-reserve-h:${height > 0 ? `${height}px` : 'min(80vh, 900px)'}` }
    }
    case 'blockAudio':
      return attrs.blockObject ? { 'data-lh-reserve': 'height', style: '--lh-reserve-h:170px' } : {}
    default:
      return {}
  }
}

/**
 * ReactNodeViewRenderer that also keeps a reference to the component it renders.
 *
 * The editor uses the returned renderer as usual. The static renderer
 * (StaticCanva, the embed and the @learnhouse/react package) reads `.component`
 * to draw the same block without a ProseMirror view, so every block has a
 * single implementation.
 */
export function lhNodeView(
  component: ComponentType<any>,
  options?: Partial<ReactNodeViewRendererOptions>,
) {
  return Object.assign(
    ReactNodeViewRenderer(component, { attrs: ({ node }) => reservedSpaceAttrs(node), ...options }),
    { component },
  )
}

export function getNodeViewComponent(renderer: unknown): ComponentType<any> | null {
  if (typeof renderer !== 'function') return null
  return (renderer as { component?: ComponentType<any> }).component ?? null
}
