// JSON.stringify leaves `<`, `>` and `&` intact, so a value containing
// `</script>` would close the tag in the server-rendered HTML stream. The
// escapes below are valid JSON string escapes and parse back identically.
export function serializeJsonLd(data: Record<string, any>) {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
}

export function JsonLd({ data }: { data: Record<string, any> }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }}
    />
  )
}
