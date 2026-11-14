import { serializeJsonLd } from './JsonLd'

/**
 * JSON-LD blocks for the `@seo` metadata slot. Server-only output: static
 * `<script type="application/ld+json">` tags, no UI.
 */
export function SeoScripts({ items }: { items: (Record<string, any> | null | undefined | false)[] }) {
  return (
    <>
      {items.filter(Boolean).map((data, i) => (
        <script key={i} type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(data as Record<string, any>) }} />
      ))}
    </>
  )
}
