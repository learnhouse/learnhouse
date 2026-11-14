'use client'
import React from 'react'
import type { MemberSummary } from '@services/organizations/memberPanel'
import MemberProfileBlock from '@ee/components/HR/People/MemberProfileBlock'
import MemberTrainingBlock from '@ee/components/HR/Training/MemberTrainingBlock'

/**
 * Blocks other features mount inside the member panel, without touching the
 * panel itself. Add an entry to PANEL_BLOCKS and it renders in its area, in
 * list order, below the panel's own content of that tab.
 *
 *   {
 *     key: 'profile-manager',
 *     area: 'overview',            // or 'security'
 *     Component: MemberProfileBlock,
 *   }
 *
 * A block gets the member id, the org id, the summary (undefined while it
 * loads) and whether the viewer may edit the member. It owns its data
 * fetching, plan gating and empty state, and returns null to hide itself.
 * Wrap it in `PanelSection` (./panelUi) to match the panel's other blocks.
 *
 * Reserved for the business features (scratchpad/business/SPEC.md):
 *   - "Profile & manager" (org_member_profile: manager, department, title,
 *     employee id…), area 'overview', editable when `canManage`.
 *   - "Required training" status, area 'overview'.
 */
export type PanelBlockArea = 'overview' | 'security'

export type PanelBlockProps = {
  userId: number
  orgId: number
  summary?: MemberSummary
  canManage: boolean
}

export type PanelBlock = {
  key: string
  area: PanelBlockArea
  Component: React.ComponentType<PanelBlockProps>
}

export const PANEL_BLOCKS: PanelBlock[] = [
  // Business features (EE; the OSS stubs render nothing).
  { key: 'profile-manager', area: 'overview', Component: MemberProfileBlock },
  { key: 'required-training', area: 'overview', Component: MemberTrainingBlock },
]

export function PanelBlocks({ area, ...props }: PanelBlockProps & { area: PanelBlockArea }) {
  const blocks = PANEL_BLOCKS.filter((b) => b.area === area)
  if (blocks.length === 0) return null
  return (
    <>
      {blocks.map(({ key, Component }) => (
        <Component key={key} {...props} />
      ))}
    </>
  )
}
