// Blocks whose files live under the activity they were uploaded to.
const MEDIA_NODE_TYPES = new Set(['blockImage', 'blockVideo', 'blockAudio', 'blockPDF', 'blockH5P'])

// The uploaded-media node types used in a document, so saving a template can
// warn that those files won't follow it into another activity.
export function mediaNodeTypes(doc: any): string[] {
  const found = new Set<string>()
  const walk = (node: any) => {
    if (!node || typeof node !== 'object') return
    if (MEDIA_NODE_TYPES.has(node.type)) found.add(node.type)
    if (Array.isArray(node.content)) node.content.forEach(walk)
  }
  walk(doc)
  return [...found]
}

// Window events the slash menu uses to open editor-level dialogs: slash
// commands only get the editor instance, not the React tree around it.
export const EDITOR_EVENTS = {
  openTemplates: 'lh-editor:open-templates',
  saveTemplate: 'lh-editor:save-template',
  viewAs: 'lh-editor:view-as',
} as const

export function emitEditorEvent(name: (typeof EDITOR_EVENTS)[keyof typeof EDITOR_EVENTS]) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(name))
}
