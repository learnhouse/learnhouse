import React, { createContext, useContext } from 'react'

// Dialogs, popovers, tooltips and hover cards portal to document.body by
// default, outside the `.lh-activity` root that scopes the package styles and
// carries the theme variables, so they render unstyled on the host page. The
// activity root provides a host element inside itself and the Radix shims
// (src/shims/radix-*.tsx) portal there instead.
export const PortalContainerContext = createContext<HTMLElement | null>(null)

export const usePortalContainer = () => useContext(PortalContainerContext)

/** Wraps a Radix `Portal` so it mounts in the activity's portal host. */
export function scopedPortal<P extends { container?: Element | DocumentFragment | null }>(
  Portal: React.ComponentType<P>,
) {
  function ScopedPortal(props: P) {
    const container = usePortalContainer()
    return <Portal {...props} container={props.container ?? container ?? undefined} />
  }
  return ScopedPortal
}
