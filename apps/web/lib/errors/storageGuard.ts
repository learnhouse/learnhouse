/**
 * Give the page a working localStorage/sessionStorage even when the browser
 * blocks them.
 *
 * Inside an LMS iframe (LTI launches, embeds) with third-party cookies blocked,
 * or with "block all site data" turned on, merely reading `window.localStorage`
 * throws SecurityError. Every theme toggle, language pick and draft save then
 * crashes whatever component touched it. An in-memory stand-in keeps the app
 * working for the visit; nothing persists, which is what the user asked for.
 */
export function createMemoryStorage(): Storage {
  const data = new Map<string, string>()
  return {
    get length() {
      return data.size
    },
    key: (index: number) => Array.from(data.keys())[index] ?? null,
    getItem: (key: string) => (data.has(key) ? (data.get(key) as string) : null),
    setItem: (key: string, value: string) => {
      data.set(String(key), String(value))
    },
    removeItem: (key: string) => {
      data.delete(key)
    },
    clear: () => {
      data.clear()
    },
  }
}

export function installStorageGuard(win: any = typeof window !== 'undefined' ? window : undefined) {
  if (!win) return
  for (const name of ['localStorage', 'sessionStorage']) {
    try {
      if (win[name]) continue
    } catch {
      // Blocked: fall through and replace it.
    }
    try {
      Object.defineProperty(win, name, { value: createMemoryStorage(), configurable: true })
    } catch {
      // Nothing more we can do; callers keep their own try/catch.
    }
  }
}
