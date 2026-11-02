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

// Blanks an author fills in when inserting a template: {{ field.company }}.
// They only ever exist in templates; inserting replaces them with plain text.
const FIELD_PATTERN = /\{\{\s*field\.([a-z0-9_]+)\s*\}\}/gi

function mapText(node: any, fn: (text: string) => string): any {
  if (!node || typeof node !== 'object') return node
  const next = { ...node }
  if (typeof next.text === 'string') next.text = fn(next.text)
  if (Array.isArray(next.content)) {
    next.content = next.content
      .map((child: any) => mapText(child, fn))
      // ProseMirror rejects empty text nodes.
      .filter((child: any) => !(child?.type === 'text' && child.text === ''))
  }
  return next
}

export function templateFields(doc: any): string[] {
  const found: string[] = []
  mapText(doc, (text) => {
    for (const match of text.matchAll(FIELD_PATTERN)) {
      const name = match[1].toLowerCase()
      if (!found.includes(name)) found.push(name)
    }
    return text
  })
  return found
}

export function fillTemplateFields(doc: any, values: Record<string, string>): any {
  return mapText(doc, (text) =>
    text.replace(FIELD_PATTERN, (_, name: string) => values[name.toLowerCase()] ?? '')
  )
}

export function fieldLabel(name: string): string {
  const words = name.replace(/_/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}
