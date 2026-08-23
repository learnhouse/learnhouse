'use client'

import React from 'react'
import { DirectionProvider as RadixDirectionProvider } from '@radix-ui/react-direction'
import { useDirection } from '@hooks/useDirection'

/**
 * Tells every Radix primitive which way the UI runs.
 *
 * Without this, `align="end"` on a dropdown means "align right" literally, and
 * arrow-key navigation in tabs and menus moves the wrong way in RTL. With it,
 * `start`/`end` become inline-relative and collision flipping is
 * direction-aware — across ~40 call sites, with no per-component changes.
 */
export default function DirectionProvider({ children }: { children: React.ReactNode }) {
  const { dir } = useDirection()

  return <RadixDirectionProvider dir={dir}>{children}</RadixDirectionProvider>
}
