import React, { forwardRef } from 'react'

type Href = string | { pathname?: string; query?: Record<string, string>; hash?: string }

interface LinkProps extends Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  href: Href
  prefetch?: boolean | null
  replace?: boolean
  scroll?: boolean
  shallow?: boolean
  passHref?: boolean
  legacyBehavior?: boolean
  locale?: string | false
}

function toUrl(href: Href): string {
  if (typeof href === 'string') return href
  const query = href.query ? `?${new URLSearchParams(href.query)}` : ''
  return `${href.pathname ?? ''}${query}${href.hash ? `#${href.hash}` : ''}`
}

// next/link as a plain anchor: the host app owns routing.
const Link = forwardRef<HTMLAnchorElement, LinkProps>(function Link(
  { href, prefetch: _p, replace: _r, scroll: _s, shallow: _sh, passHref: _ph, legacyBehavior: _lb, locale: _lo, ...rest },
  ref,
) {
  return <a ref={ref} href={toUrl(href)} {...rest} />
})

export default Link
