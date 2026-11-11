'use client'

import { usePathname } from 'next/navigation'
import { track } from '../Analytics/PostHogProvider'
import { ctaUrl } from '@/lib/cta'

/**
 * A link to LearnHouse Cloud with UTM tags for the current page, that records
 * a `docs_cta_click` event. Use it for every link that asks readers to sign up.
 */
export default function CtaLink({ href, placement, term, children, ...props }) {
  const route = usePathname() || '/'
  const url = ctaUrl(href, { placement, route, term })
  return (
    <a
      {...props}
      href={url}
      onClick={(event) => {
        track('docs_cta_click', { placement, destination: href, page: route, term })
        props.onClick?.(event)
      }}
    >
      {children}
    </a>
  )
}
