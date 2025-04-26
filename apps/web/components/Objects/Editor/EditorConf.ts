import { Link as LinkExtension } from '@tiptap/extension-link'

export const getLinkExtension = () => {
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
        // construct URL
        const parsedUrl = url.includes(':') ? new URL(url) : new URL(`${ctx.defaultProtocol}://${url}`)

        // use default validation
        if (!ctx.defaultValidate(parsedUrl.href)) {
          return false
        }

        // disallowed protocols
        const disallowedProtocols = ['ftp', 'file', 'mailto']
        const protocol = parsedUrl.protocol.replace(':', '')

        if (disallowedProtocols.includes(protocol)) {
          return false
        }

        // only allow protocols specified in ctx.protocols
        const allowedProtocols = ctx.protocols.map((p: any) => (typeof p === 'string' ? p : p.scheme))

        if (!allowedProtocols.includes(protocol)) {
          return false
        }

        // all checks have passed
        return true
      } catch {
        return false
      }
    },
    shouldAutoLink: (url: string) => {
      try {
        // construct URL
        const parsedUrl = url.includes(':') ? new URL(url) : new URL(`https://${url}`)

        // only auto-link if the domain is not in the disallowed list
        const disallowedDomains = ['example-no-autolink.com', 'another-no-autolink.com']
        const domain = parsedUrl.hostname

        return !disallowedDomains.includes(domain)
      } catch {
        return false
      }
    },
  })
} 