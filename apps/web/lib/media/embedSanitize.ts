/*
 Sanitize user-pasted embed code (the "code" mode of embed blocks). Iframes are
 always sandboxed; only well-known embed providers additionally get
 allow-same-origin, which many players need to work.
*/
import DOMPurify from 'dompurify'

const BASE_SANDBOX = 'allow-scripts allow-popups allow-presentation allow-forms'

// Hosts (and their subdomains) of the providers the embed UI advertises.
const SAME_ORIGIN_EMBED_HOSTS = [
  'youtube.com',
  'youtube-nocookie.com',
  'vimeo.com',
  'spotify.com',
  'loom.com',
  'google.com',
  'codepen.io',
  'canva.com',
  'notion.so',
  'notion.site',
  'figma.com',
  'giphy.com',
  'replit.com',
  'miro.com',
  'emgithub.com',
  'twitter.com',
  'x.com',
]

/** The sandbox value to force on an iframe with this src. */
export function iframeSandboxFor(src: string | null | undefined): string {
  try {
    const u = new URL(src || '')
    if (u.protocol !== 'https:') return BASE_SANDBOX
    const host = u.hostname.toLowerCase()
    if (SAME_ORIGIN_EMBED_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) {
      return `${BASE_SANDBOX} allow-same-origin`
    }
  } catch {
    /* relative or unparseable src */
  }
  return BASE_SANDBOX
}

const ALLOWED_ATTR = [
  'src', 'frameborder', 'allowfullscreen', 'allow', 'width', 'height',
  'class', 'title', 'loading', 'referrerpolicy', 'scrolling', 'name',
]

// Private DOMPurify instance so the hook never leaks into other sanitize calls.
let purifier: ReturnType<typeof DOMPurify> | null = null

function getPurifier() {
  if (purifier) return purifier
  purifier = DOMPurify(window)
  purifier.addHook('afterSanitizeAttributes', (node) => {
    if (node.nodeName === 'IFRAME') {
      node.setAttribute('sandbox', iframeSandboxFor(node.getAttribute('src')))
    }
  })
  return purifier
}

export function sanitizeEmbedCode(code: string): string {
  if (!code || typeof window === 'undefined') return ''
  return getPurifier().sanitize(code, {
    ADD_TAGS: ['iframe'],
    ALLOWED_ATTR,
  }) as string
}
