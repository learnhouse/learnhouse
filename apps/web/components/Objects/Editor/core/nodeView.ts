import { ReactNodeViewRenderer } from '@tiptap/react'
import type { ReactNodeViewRendererOptions } from '@tiptap/react'
import type { ComponentType } from 'react'

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
  return Object.assign(ReactNodeViewRenderer(component, options), { component })
}

export function getNodeViewComponent(renderer: unknown): ComponentType<any> | null {
  if (typeof renderer !== 'function') return null
  return (renderer as { component?: ComponentType<any> }).component ?? null
}
