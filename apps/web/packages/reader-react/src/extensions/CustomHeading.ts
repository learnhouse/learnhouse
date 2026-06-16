import Heading from '@tiptap/extension-heading'

/**
 * Heading extension that injects a slugified `id` attribute so the
 * table-of-contents can anchor-link into the document.
 */
export const CustomHeading = Heading.extend({
  renderHTML({ node, HTMLAttributes }: { node: any; HTMLAttributes: any }) {
    const hasLevel = this.options.levels.includes(node.attrs.level)
    const level = hasLevel ? node.attrs.level : this.options.levels[0]

    const headingText = node.textContent ?? ''
    const slug = headingText
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_-]+/g, '-')
      .replace(/^-+|-+$/g, '')

    const id = slug
      ? `heading-${slug}`
      : `heading-${Math.random().toString(36).slice(2, 11)}`

    return [`h${level}`, { ...HTMLAttributes, id }, 0]
  },
})

export default CustomHeading
