import { useEffect, useState } from 'react'
import { Editor } from '@tiptap/react'
import { Check } from 'lucide-react'

interface TableOfContentsProps {
  editor: Editor | null
}

interface HeadingItem {
  level: number
  text: string
  id: string
}


const TableOfContents = ({ editor }: TableOfContentsProps) => {
  const [headings, setHeadings] = useState<HeadingItem[]>([])
  const [open, setOpen] = useState(true)

  useEffect(() => {
    if (!editor) return

    const updateHeadings = () => {
      const items: HeadingItem[] = []
      editor.state.doc.descendants((node) => {
        if (node.type.name.startsWith('heading')) {
          const level = node.attrs.level || 1
          const headingText = node.textContent || ''

          // Create slug from heading text (same logic as CustomHeading in DynamicCanva)
          const slug = headingText
            .toLowerCase()
            .trim()
            .replace(/[^\w\s-]/g, '') // Remove special characters
            .replace(/[\s_-]+/g, '-') // Replace spaces and underscores with hyphens
            .replace(/^-+|-+$/g, '') // Remove leading/trailing hyphens

          const id = slug ? `heading-${slug}` : `heading-${Math.random().toString(36).substr(2, 9)}`

          items.push({
            level,
            text: node.textContent,
            id,
          })
        }
      })
      setHeadings(items)
    }

    editor.on('update', updateHeadings)
    updateHeadings()

    return () => {
      editor.off('update', updateHeadings)
    }
  }, [editor])

  if (headings.length === 0) return null

  return (
    <div className="w-full bg-none border-none shadow-none p-0 m-0 font-[inherit] flex flex-col items-stretch h-fit">
      <ul className="!list-none !p-0 m-0">
        {headings.map((heading, index) => (
          <li
            key={index}
            className="toc-item my-2 !list-none flex items-start gap-2"
            style={{ paddingLeft: `${(heading.level - 1) * 1.2}rem` }}
          >
            <span className="toc-check"><Check size={15} strokeWidth={1.7} /></span>
            <a className={`toc-link toc-link-h${heading.level}`} href={`#${heading.id}`}>{heading.text}</a>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default TableOfContents
