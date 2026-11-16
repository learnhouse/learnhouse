import type { NodeViewProps } from '@tiptap/react'

/** Swap the node behind a node view for other content (e.g. image → Library block). */
export function replaceBlock(props: Pick<NodeViewProps, 'editor' | 'getPos' | 'node'>, content: any) {
  const pos = typeof props.getPos === 'function' ? props.getPos() : undefined
  if (typeof pos !== 'number') return false
  return props.editor
    .chain()
    .focus()
    .insertContentAt({ from: pos, to: pos + props.node.nodeSize }, content)
    .run()
}

/** Remove the node behind a node view. */
export function deleteBlock(props: Pick<NodeViewProps, 'editor' | 'getPos' | 'node'>) {
  const pos = typeof props.getPos === 'function' ? props.getPos() : undefined
  if (typeof pos !== 'number') return false
  return props.editor.chain().focus().deleteRange({ from: pos, to: pos + props.node.nodeSize }).run()
}

/** Open the browser's file picker without a permanent <input>. */
export function pickFile(accept: string, onFile: (_file: File) => void) {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = accept
  input.onchange = () => {
    const file = input.files?.[0]
    if (file) onFile(file)
  }
  input.click()
}
