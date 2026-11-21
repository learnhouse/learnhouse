import * as React from 'react'

// React.cache (per-request dedupe for server components) only exists in
// React 19. Client code shared with @learnhouse/react also runs in apps on
// React 18, where importing it by name gives undefined and calling it throws
// on load. In the browser cache() is a pass-through anyway.
export const cache: typeof React.cache =
  (React as { cache?: typeof React.cache }).cache ?? (<T extends Function>(fn: T): T => fn)
