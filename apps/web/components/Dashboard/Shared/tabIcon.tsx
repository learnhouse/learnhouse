'use client'
import React from 'react'
import { IconContext } from '@phosphor-icons/react'

// Tab icons use Phosphor's duotone (semi-filled) weight everywhere, whatever
// weight the page passed. Icons without an explicit weight pick it up from the
// context; icons that set one are overridden.
const DUOTONE = { weight: 'duotone' as const }

export function TabIcon({ icon }: { icon: React.ReactNode }) {
  const node =
    React.isValidElement<{ weight?: string }>(icon) && icon.props.weight !== undefined
      ? React.cloneElement(icon, { weight: 'duotone' })
      : icon
  return <IconContext.Provider value={DUOTONE}>{node}</IconContext.Provider>
}
