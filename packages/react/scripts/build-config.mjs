import path from 'node:path'
import { fileURLToPath } from 'node:url'

const shims = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/shims')

// Third-party modules swapped only when web source imports them; each shim
// imports the real package, which stays external. Radix portals mount inside
// the activity root instead of document.body (see src/portal.tsx).
export const WEB_IMPORT_SHIMS = {
  '@radix-ui/react-dialog': `${shims}/radix-dialog.tsx`,
  '@radix-ui/react-popover': `${shims}/radix-popover.tsx`,
  '@radix-ui/react-tooltip': `${shims}/radix-tooltip.tsx`,
  '@radix-ui/react-hover-card': `${shims}/radix-hover-card.tsx`,
}
