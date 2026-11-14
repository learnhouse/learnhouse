// OSS stub: company pages require Enterprise Edition (their routes 404).
import type { Metadata } from 'next'

const none = async (_props: unknown): Promise<Metadata> => ({ robots: { index: false, follow: false } })
export const teamPortalMetadata = none
export const teamJoinMetadata = none
export const teamPurchaseMetadata = none
export const companySpaceMetadata = none
