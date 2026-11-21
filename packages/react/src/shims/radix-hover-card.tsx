// @radix-ui/react-hover-card for web source bundled into the package: its Portal
// mounts inside the activity root (see src/portal.tsx).
import * as Radix from '@radix-ui/react-hover-card'
import { scopedPortal } from '../portal'

export * from '@radix-ui/react-hover-card'
export const Portal = scopedPortal(Radix.Portal as any)
export const HoverCardPortal = Portal
