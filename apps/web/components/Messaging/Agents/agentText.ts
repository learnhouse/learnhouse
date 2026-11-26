import type { TFunction } from 'i18next'
import type { AgentSummary, AgentTone } from '@services/messaging/messaging'

// Labels live under messaging.agent_tones, hints under messaging.agent_tone_hints.
export const TONES: AgentTone[] = ['friendly', 'concise', 'socratic', 'expert', 'playful']

// The description ensure_default_agent (apps/api/src/services/messaging/agents.py)
// gives every org's Copilot. Admins can change it; only the untouched seed is
// swapped for the reader's language.
const COPILOT_SEED_DESCRIPTION = 'Answers from every course you can access, plus its own general knowledge.'

/** An agent's description, with the built-in Copilot's default text translated. */
export function agentDescription(
  agent: Pick<AgentSummary, 'description' | 'is_default'> | null | undefined,
  t: TFunction
): string {
  if (!agent) return ''
  if (agent.is_default && agent.description?.trim() === COPILOT_SEED_DESCRIPTION) {
    return t('messaging.agents_gallery.copilot_description')
  }
  return agent.description || ''
}
