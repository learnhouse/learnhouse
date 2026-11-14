import { vi } from 'vitest'

export interface Call {
  url: string
  method: string
  headers: Headers
  body: unknown
  init: RequestInit
}

type Responder = Response | Error | ((call: Call) => Response | Promise<Response> | Error)

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

/**
 * A fetch mock that answers with the queued responders in order (the last one
 * repeats) and records every call.
 */
export function mockFetch(...responders: Responder[]) {
  const calls: Call[] = []
  const fn = vi.fn(async (input: string, init: RequestInit = {}) => {
    const call: Call = {
      url: input,
      method: init.method ?? 'GET',
      headers: new Headers(init.headers),
      body: init.body,
      init,
    }
    calls.push(call)
    const r = responders[Math.min(calls.length - 1, responders.length - 1)]
    const out = typeof r === 'function' ? await r(call) : r
    if (out instanceof Error) throw out
    // Responses can only be read once; hand out a copy each time.
    return out.clone()
  })
  return { fetch: fn, calls }
}

/** A fetch that never resolves until its signal aborts, like a hung server. */
export function hangingFetch() {
  const calls: Call[] = []
  const fn = vi.fn(
    (input: string, init: RequestInit = {}) =>
      new Promise<Response>((_resolve, reject) => {
        calls.push({ url: input, method: init.method ?? 'GET', headers: new Headers(init.headers), body: init.body, init })
        init.signal?.addEventListener('abort', () => {
          const err = new Error('This operation was aborted')
          err.name = 'AbortError'
          reject(err)
        })
      }),
  )
  return { fetch: fn, calls }
}
