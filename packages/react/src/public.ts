// Types-only entry for dist/index.d.ts. The runtime entry (index.ts) bundles
// the LearnHouse web app's source, whose types don't belong in this package's
// public surface; tests/exports.test.ts keeps both entries in sync.
import type { FC, CSSProperties } from 'react'
import type { LearnHouseClient } from '@learnhouse/sdk'
import type { LearnHouseActivityProps, LearnHouseProviderProps, LearnHouseTheme } from './types'

export type * from './types'

export declare const LearnHouseActivity: FC<LearnHouseActivityProps>
export declare const LearnHouseProvider: FC<LearnHouseProviderProps>
export declare function useLearnHouseClient(): LearnHouseClient
export declare function themeToStyle(theme?: LearnHouseTheme): CSSProperties
export declare const SUPPORTED_LOCALES: string[]
export declare const VERSION: string
