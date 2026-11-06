import { afterEach } from 'vitest'
import { enableAutoUnmount } from '@vue/test-utils'

enableAutoUnmount(afterEach)

// jsdom lacks these; the renderer only feature-detects them.
class Observer {
  observe() {}
  unobserve() {}
  disconnect() {}
}
;(globalThis as any).ResizeObserver ??= Observer
;(globalThis as any).IntersectionObserver ??= Observer
window.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener() {},
  removeListener() {},
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent: () => false,
})) as any
window.scrollTo = () => {}
