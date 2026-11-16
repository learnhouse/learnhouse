/*
 How the rest of the editor reaches the AI Editor: the "/ai" slash items and
 the selection menu's AI actions open the panel and run through the same
 engine (Atlas turn, reviewable proposals), by window event, so neither has
 to import the panel.
*/

export const AI_EDITOR_EVENT = 'lh:ai-editor'

export interface AIEditorRequest {
  /** 'open' just opens the panel; anything else is a quick action id. */
  action?: string
  /** The message to send (else the action's default message). */
  message?: string
  /** Tone, language or level for actions that take one. */
  param?: string
  /** Focus the composer instead of sending. */
  compose?: boolean
}

let engineReady = false

/** Set by the AI Editor once its Atlas engine answered (EE API present, AI on). */
export function setAIEditorEngineReady(ready: boolean): void {
  engineReady = ready
}

export function isAIEditorEngineReady(): boolean {
  return engineReady
}

export function requestAIEditor(request: AIEditorRequest): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<AIEditorRequest>(AI_EDITOR_EVENT, { detail: request }))
}

// The selection menu's actions, mapped onto AI Editor actions.
const BUBBLE_ACTIONS: Record<string, { action: string; param?: string }> = {
  improve: { action: 'improve' },
  shorten: { action: 'shorten' },
  expand: { action: 'expand' },
  grammar: { action: 'grammar' },
  tone_friendly: { action: 'tone', param: 'friendly' },
  tone_formal: { action: 'tone', param: 'formal' },
  tone_confident: { action: 'tone', param: 'confident' },
  translate: { action: 'translate' },
  explain: { action: 'explain' },
  quiz: { action: 'quiz' },
  flashcards: { action: 'flashcards' },
}

/**
 * Hand a selection menu AI action to the AI Editor. Returns false (and does
 * nothing) when the engine isn't available, so the menu keeps its own flow.
 */
export function routeSelectionAction(action: string, language?: string): boolean {
  const mapped = BUBBLE_ACTIONS[action]
  if (!engineReady || !mapped) return false
  requestAIEditor({ action: mapped.action, param: mapped.param ?? (action === 'translate' ? language : undefined) })
  return true
}
