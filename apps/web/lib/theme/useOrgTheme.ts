'use client'
import { useMemo } from 'react'
import { useOrg } from '@components/Contexts/OrgContext'
import { readOrgTheme, type OrgThemeState } from './orgTheme'

/** The current org's theme, sanitized (see lib/theme/orgTheme.ts). */
export function useOrgTheme(): OrgThemeState {
  const org = useOrg() as any
  return useMemo(() => readOrgTheme(org), [org])
}
