import { Link as LinkExtension } from '@tiptap/extension-link'

export function getLinkExtension() {
  return LinkExtension.configure({
    openOnClick: true,
    HTMLAttributes: {
      target: '_blank',
      rel: 'noopener noreferrer',
    },
    autolink: true,
    defaultProtocol: 'https',
    protocols: ['http', 'https'],
    isAllowedUri: (url: string, ctx: any) => {
      try {
        const parsedUrl = url.includes(':')
          ? new URL(url)
          : new URL(`${ctx.defaultProtocol}://${url}`)
        if (!ctx.defaultValidate(parsedUrl.href)) return false
        const disallowed = ['ftp', 'file', 'mailto']
        const protocol = parsedUrl.protocol.replace(':', '')
        if (disallowed.includes(protocol)) return false
        const allowed = ctx.protocols.map((p: any) =>
          typeof p === 'string' ? p : p.scheme,
        )
        return allowed.includes(protocol)
      } catch {
        return false
      }
    },
    shouldAutoLink: (url: string) => {
      try {
        const parsedUrl = url.includes(':') ? new URL(url) : new URL(`https://${url}`)
        const disallowedDomains = ['example-no-autolink.com', 'another-no-autolink.com']
        return !disallowedDomains.includes(parsedUrl.hostname)
      } catch {
        return false
      }
    },
  })
}
