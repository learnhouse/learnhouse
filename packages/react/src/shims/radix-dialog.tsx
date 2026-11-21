// @radix-ui/react-dialog for web source bundled into the package: its Portal
// mounts inside the activity root (see src/portal.tsx).
import * as Radix from '@radix-ui/react-dialog'
import { scopedPortal } from '../portal'

export * from '@radix-ui/react-dialog'
export const Portal = scopedPortal(Radix.Portal as any)
export const DialogPortal = Portal
