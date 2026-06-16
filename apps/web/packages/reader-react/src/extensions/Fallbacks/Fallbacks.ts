import { mergeAttributes, Node } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import FallbackBlockComponent from './FallbackBlockComponent'

function makePlaceholder(name: string, label: string, tag: string) {
  return Node.create({
    name,
    group: 'block',
    draggable: false,
    atom: true,
    addAttributes() {
      return {
        _label: { default: label, rendered: false },
      }
    },
    parseHTML() {
      return [{ tag }]
    },
    renderHTML({ HTMLAttributes }) {
      return [tag, mergeAttributes(HTMLAttributes)]
    },
    addNodeView() {
      return ReactNodeViewRenderer(FallbackBlockComponent as any)
    },
  })
}

/**
 * Lightweight placeholders for blocks the reader doesn't yet implement
 * natively (Flipcard, Scenarios, CodePlayground, User mention block, WebPreview,
 * MagicBlock). Without these, ProseMirror drops the unknown nodes and the
 * surrounding content collapses. The placeholder keeps the document shape
 * intact and tells the reader the block isn't available here.
 */
export const FlipcardFallback = makePlaceholder('flipcard', 'Flip card', 'flipcard-block')
export const ScenariosFallback = makePlaceholder('scenarios', 'Scenario', 'scenarios-block')
export const CodePlaygroundFallback = makePlaceholder('blockCode', 'Code playground', 'block-code')
export const UserBlockFallback = makePlaceholder('blockUser', 'User mention', 'block-user')
export const WebPreviewFallback = makePlaceholder('blockWebPreview', 'Web preview', 'block-webpreview')
export const MagicBlockFallback = makePlaceholder('blockMagic', 'AI block', 'block-magic')

export const fallbackExtensions = [
  FlipcardFallback,
  ScenariosFallback,
  CodePlaygroundFallback,
  UserBlockFallback,
  WebPreviewFallback,
  MagicBlockFallback,
]
