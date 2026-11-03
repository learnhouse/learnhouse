// Errors Sentry receives that say nothing about our code. Each one is either
// the visitor's connection, a crawler, or another SDK's internals, and none of
// them has a fix in this repo. Shared by the client and server Sentry configs.

type Frame = { filename?: string; function?: string }

// The connection dropped mid-request. Browsers word it differently; Sentry
// appends the host in parentheses ("Failed to fetch (api.learnhouse.io)").
const NETWORK_FAILURE =
  /^(TypeError: |Error: )?(Failed to fetch|Load failed|NetworkError when attempting to fetch resource\.?|NetworkError: A network error occurred\.?|A network error occurred\.?)( \(.+\))?$/

// A <link> or <script> failed to load and something awaited it. The rejection
// value is a DOM Event, not an Error, so there's no stack to act on; in
// practice it's headless crawlers that cancel asset loads.
const DOM_EVENT_REJECTION = /^Event `\w*` \(type=error\) captured as promise rejection/

export function isClientNoise(message: string, frames: Frame[] = []): boolean {
  if (NETWORK_FAILURE.test(message)) return true
  if (DOM_EVENT_REJECTION.test(message)) return true
  // Session Replay compresses in a Web Worker. When the worker can't start
  // (strict CSP, bots) its handshake reply is null and the SDK's own listener
  // throws reading `.success` off it.
  if (message.includes("(reading 'success')") && frames.some((f) => (f.function ?? '').includes('_worker'))) {
    return true
  }
  return false
}

export function isServerNoise(message: string): boolean {
  // The browser went away mid-upload (tab closed, navigation, flaky network),
  // so the multipart body never got its closing boundary.
  if (message.includes('missing final boundary while parsing FormData')) return true
  return false
}
