// @radix-ui/react-tooltip for web source bundled into the package: its Portal
// mounts inside the activity root (see src/portal.tsx).
import * as Radix from '@radix-ui/react-tooltip'
import { scopedPortal } from '../portal'

export * from '@radix-ui/react-tooltip'
export const Portal = scopedPortal(Radix.Portal as any)
export const TooltipPortal = Portal
