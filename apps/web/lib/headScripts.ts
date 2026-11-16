import 'server-only'
import fs from 'node:fs'
import path from 'node:path'

// The scripts that must run before the page paints or hydrates (see the root
// layout). They used to be four synchronous <script src> tags: four blocking
// round trips before the first paint on a cold load. Their sources stay in
// public/ (tests read them there, and the files are still served as the
// fallback), and the layout inlines their text instead.

const cache = new Map<string, string | null>()

function read(file: string): string | null {
  // Development keeps the external <script src> tags. Reading files from a
  // server component on every request makes the Turbopack dev server treat
  // them as changed dependencies: it recompiles on each request and the page
  // reloads in a loop. Inlining only matters for production first loads.
  if (process.env.NODE_ENV !== 'production') return null
  if (cache.has(file)) return cache.get(file) ?? null
  let text: string | null = null
  try {
    text = fs.readFileSync(path.join(process.cwd(), 'public', file), 'utf8')
  } catch {
    text = null
  }
  // A literal "</script" in the text would end the inline <script> early.
  if (text !== null) text = text.replace(/<\/(script)/gi, '<\\/$1')
  // Only hits are kept: a file written after startup is picked up next time.
  if (text !== null) cache.set(file, text)
  return text
}

// Generated at startup from the environment (server-wrapper.js in the image,
// next.config.js in development), so read it like the browser would have,
// rather than rebuilding it here. Null when it doesn't exist yet: the layout
// then keeps the external tag, as before.
export function runtimeConfigScript(): string | null {
  return read('runtime-config.js')
}

export function dirInitScript(): string | null {
  return read('dir-init.js')
}

export function embedBgScript(): string | null {
  return read('embed-bg.js')
}

export function themeInitScript(): string | null {
  return read('theme-init.js')
}

export function translateGuardScript(): string | null {
  return read('translate-guard.js')
}
