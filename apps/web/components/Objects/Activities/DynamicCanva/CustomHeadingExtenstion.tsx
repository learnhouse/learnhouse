import Heading from '@tiptap/extension-heading'

// Custom Heading extension that adds IDs
export const CustomHeading = Heading.extend({
  renderHTML({ node, HTMLAttributes }: { node: any; HTMLAttributes: any }) {
    const hasLevel = this.options.levels.includes(node.attrs.level)
    const level = hasLevel ? node.attrs.level : this.options.levels[0]

    // Generate ID from heading text
    const headingText = node.textContent || ''
    const slug = headingText
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '') // Remove special characters
      .replace(/[\s_-]+/g, '-') // Replace spaces and underscores with hyphens
      .replace(/^-+|-+$/g, '') // Remove leading/trailing hyphens
    
    const id = slug ? `heading-${slug}` : `heading-${Math.random().toString(36).substr(2, 9)}`

    return [
      `h${level}`,
      {
        ...HTMLAttributes,
        id,
      },
      0,
    ]
  },
})