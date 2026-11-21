'use client'
/*
 Node views (and editor-only pieces of them) whose code loads on demand,
 like the Experiences blocks.

 The schemas stay eager (parsing, collab, old content); a view's React code
 is its own chunk, fetched the first time a document shows that block. Until
 then `Fallback` renders with the same props: for blocks with content it is
 the view's own learner markup before hydration, so the text is on the page
 at once (server renders included) and nothing moves when the view arrives.

 Once a view's chunk has loaded (or was preloaded), later renders resolve it
 synchronously and never show the fallback.
*/
import React, { Suspense, lazy, type ComponentType } from 'react'

type Loaded = { default: ComponentType<any> }

export function lazyView<P extends object>(
  name: string,
  load: () => Promise<Loaded>,
  Fallback: ComponentType<P> | null = null,
): ComponentType<P> & { preload: () => Promise<unknown> } {
  let loaded: Loaded | null = null
  let pending: Promise<Loaded> | null = null
  const preload = () =>
    (pending ??= load().then(
      (mod) => (loaded = mod),
      (error) => {
        pending = null
        throw error
      },
    ))
  // React.lazy reads an already-loaded module synchronously through this
  // thenable, so a preloaded view renders on the first pass.
  const Lazy = lazy(() => (loaded ? ({ then: (resolve: (_m: Loaded) => void) => resolve(loaded!) } as any) : preload()))
  // Named after the view it stands for (React DevTools, tests).
  const View = {
    [name]: (props: P) => (
      <Suspense fallback={Fallback ? <Fallback {...props} /> : null}>
        <Lazy {...props} />
      </Suspense>
    ),
  }[name] as ComponentType<P> & { preload: () => Promise<unknown> }
  View.displayName = name
  View.preload = preload
  return View
}
