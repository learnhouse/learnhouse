import React, { Suspense, lazy } from 'react'
import type { ComponentType } from 'react'

type Loader = () => Promise<any>

interface DynamicOptions {
  loading?: ComponentType<any>
  ssr?: boolean
}

// next/dynamic on top of React.lazy. Blocks that the web app splits out keep
// their own chunk in the package, so a document only loads the blocks it uses.
export default function dynamic(loader: Loader, options: DynamicOptions = {}) {
  const Lazy = lazy(async () => {
    const mod = await loader()
    return { default: typeof mod === 'function' ? mod : (mod?.default ?? mod) }
  })
  const Loading = options.loading
  function Dynamic(props: any) {
    return (
      <Suspense fallback={Loading ? <Loading /> : null}>
        <Lazy {...props} />
      </Suspense>
    )
  }
  return Dynamic
}
