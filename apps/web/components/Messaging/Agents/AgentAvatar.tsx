'use client'

import React from 'react'
import type { AgentSummary } from '@services/messaging/messaging'
import { AIMark } from '@components/Objects/AI/AIBrand'

export type AgentAvatarProps = {
  agent: Pick<AgentSummary, 'emoji' | 'color' | 'secondary_color' | 'name'> & { is_default?: boolean }
  size?: number
  className?: string
}

/** The LearnHouse AI mark Copilot wears instead of an emoji tile. */
export const COPILOT_LOGO = '/learnhouse_ai_simple_colored.png'

/** An agent's face: its two colors as a rounded tile, its emoji on top. Copilot wears the LearnHouse AI mark. */
export default function AgentAvatar({ agent, size = 36, className = '' }: AgentAvatarProps) {
  const radius = Math.max(6, Math.round(size * 0.25))
  if (agent.is_default) {
    return (
      <span title={agent.name} className="inline-flex shrink-0">
        <AIMark size={size} alt={agent.name} className={className} />
      </span>
    )
  }
  return (
    <div
      className={`relative inline-flex items-center justify-center shrink-0 select-none overflow-hidden ${className}`}
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: `linear-gradient(140deg, ${agent.color} 0%, ${agent.secondary_color} 100%)`,
      }}
      role="img"
      aria-label={agent.name}
      title={agent.name}
    >
      <span className="relative leading-none" style={{ fontSize: Math.round(size * 0.52) }}>
        {agent.emoji || '✨'}
      </span>
    </div>
  )
}
