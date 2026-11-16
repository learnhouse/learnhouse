// A Server-Sent Events parser for fetch() bodies, following the WHATWG
// event-stream rules: LF, CR and CRLF line ends (also split across chunks),
// multi-line `data:`, `:` comment lines, `id:` that sticks until changed, and
// `retry:`. EventSource can't send an Authorization header or POST, so the
// Agent API is read through fetch and this parser.

export interface SSEFrame {
  /** `event:` field, `message` when absent. */
  event: string
  /** `data:` lines joined with `\n`. */
  data: string
  /** The last event id seen so far (ids persist across frames), or null. */
  id: string | null
  /** `retry:` in ms, when the frame carried one. */
  retry?: number
}

/** Incremental parser: push decoded text, get complete frames back. */
export class SSEParser {
  private buffer = ''
  private pendingCR = false
  private event = ''
  private data: string[] = []
  private hasData = false
  private retry: number | undefined
  /** Last event id (persists across frames, like EventSource's). */
  lastEventId: string | null = null

  push(chunk: string): SSEFrame[] {
    const frames: SSEFrame[] = []
    let text = chunk
    // A CR ended the previous chunk; a LF opening this one belongs to it.
    if (this.pendingCR) {
      this.pendingCR = false
      if (text.charAt(0) === '\n') text = text.slice(1)
    }
    this.buffer += text
    let start = 0
    for (let i = 0; i < this.buffer.length; i++) {
      const ch = this.buffer.charCodeAt(i)
      if (ch !== 10 && ch !== 13) continue
      const line = this.buffer.slice(start, i)
      if (ch === 13) {
        if (i + 1 < this.buffer.length) {
          if (this.buffer.charCodeAt(i + 1) === 10) i++
        } else {
          this.pendingCR = true
        }
      }
      start = i + 1
      const frame = this.line(line)
      if (frame) frames.push(frame)
    }
    this.buffer = this.buffer.slice(start)
    return frames
  }

  /** End of stream: a final frame without its blank line is discarded, per spec. */
  end(): SSEFrame[] {
    this.buffer = ''
    this.reset()
    return []
  }

  private reset() {
    this.event = ''
    this.data = []
    this.hasData = false
    this.retry = undefined
  }

  private line(line: string): SSEFrame | null {
    if (line === '') {
      if (!this.hasData) {
        this.reset()
        return null
      }
      const frame: SSEFrame = { event: this.event || 'message', data: this.data.join('\n'), id: this.lastEventId }
      if (this.retry !== undefined) frame.retry = this.retry
      this.reset()
      return frame
    }
    if (line.charAt(0) === ':') return null // comment / keep-alive
    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    let value = colon === -1 ? '' : line.slice(colon + 1)
    if (value.charAt(0) === ' ') value = value.slice(1)
    switch (field) {
      case 'event':
        this.event = value
        break
      case 'data':
        this.data.push(value)
        this.hasData = true
        break
      case 'id':
        // An id with NUL is ignored by the spec.
        if (value.indexOf('\u0000') === -1) this.lastEventId = value
        break
      case 'retry':
        if (/^\d+$/.test(value)) this.retry = Number(value)
        break
      default:
        break
    }
    return null
  }
}

/**
 * Reads a byte stream as SSE frames. Cancels the reader when the consumer
 * stops early (break / return) or `signal` aborts.
 */
export async function* readSSE(
  body: ReadableStream<Uint8Array>,
  options: { signal?: AbortSignal; parser?: SSEParser } = {},
): AsyncGenerator<SSEFrame, void, undefined> {
  const parser = options.parser ?? new SSEParser()
  const reader = body.getReader()
  const decoder = new TextDecoder()
  const onAbort = () => {
    reader.cancel().catch(() => {})
  }
  options.signal?.addEventListener('abort', onAbort)
  let finished = false
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) {
        const tail = decoder.decode()
        if (tail) yield* parser.push(tail)
        parser.end()
        finished = true
        return
      }
      const frames = parser.push(decoder.decode(value, { stream: true }))
      for (const frame of frames) yield frame
    }
  } finally {
    options.signal?.removeEventListener('abort', onAbort)
    if (!finished) reader.cancel().catch(() => {})
    try {
      reader.releaseLock()
    } catch {
      // already released
    }
  }
}
