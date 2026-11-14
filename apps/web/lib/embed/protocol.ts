// The activity embed (/embed/...) talks to the page that frames it with
// window.postMessage. Messages from the embed carry `source: 'learnhouse'`;
// messages from the host page (public/embed.js) carry `source: 'learnhouse-host'`.
// Both sides check `event.source`, so only the framing page and its own
// iframes are listened to. Bump EMBED_PROTOCOL_VERSION on breaking changes.

export const EMBED_SOURCE = 'learnhouse'
export const EMBED_HOST_SOURCE = 'learnhouse-host'
export const EMBED_PROTOCOL_VERSION = 1

export type EmbedEventType = 'ready' | 'resize' | 'complete' | 'media' | 'link_click' | 'unavailable'

export interface EmbedMessage {
  source: typeof EMBED_SOURCE
  version: typeof EMBED_PROTOCOL_VERSION
  type: EmbedEventType
  activityId: string
  [key: string]: unknown
}

export function embedMessage(type: EmbedEventType, activityId: string, data: Record<string, unknown> = {}): EmbedMessage {
  return { ...data, source: EMBED_SOURCE, version: EMBED_PROTOCOL_VERSION, type, activityId }
}

/** A message the host page sends to the embed, e.g. the `hello` that asks for the current size. */
export function isHostMessage(data: unknown): data is { source: typeof EMBED_HOST_SOURCE; type: string } {
  return !!data && typeof data === 'object' && (data as { source?: unknown }).source === EMBED_HOST_SOURCE &&
    typeof (data as { type?: unknown }).type === 'string'
}

const HEX_COLOR_RE = /^[0-9a-fA-F]{3,8}$/

export interface EmbedOptions {
  /** CSS color, `transparent`, or null for the activity type's default. */
  bgcolor: string | null
  textcolor: string | null
  /** A supported UI language, or null to keep the organization's. */
  locale: string | null
  showLogo: boolean
}

type ParamSource = { get(_name: string): string | null }

/** Reads the embed's URL options. Anything invalid is ignored rather than injected into styles. */
export function parseEmbedOptions(params: ParamSource, supportedLocales: readonly string[]): EmbedOptions {
  const color = (raw: string | null) => (raw && HEX_COLOR_RE.test(raw) ? `#${raw}` : null)
  const bg = params.get('bgcolor')
  const locale = params.get('locale')?.toLowerCase().split('-')[0] ?? null
  return {
    bgcolor: bg === 'transparent' ? 'transparent' : color(bg),
    textcolor: color(params.get('textcolor')),
    locale: locale && supportedLocales.includes(locale) ? locale : null,
    showLogo: params.get('showlearnhouselogo') !== 'false',
  }
}

/** The snippet the share menu copies: the iframe plus the helper that sizes it to its content. */
export function embedSnippet(embedUrl: string, origin: string): string {
  return [
    `<iframe src="${embedUrl}" width="100%" height="600" style="border:0" allow="fullscreen; autoplay" allowfullscreen data-learnhouse-embed></iframe>`,
    `<script src="${origin}/embed.js" async></script>`,
  ].join('\n')
}
