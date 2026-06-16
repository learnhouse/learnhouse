'use client'

import { useEffect, useState } from 'react'
import type { Editor } from '@tiptap/react'

interface TableOfContentsProps {
  editor: Editor | null
}

interface HeadingItem {
  level: number
  text: string
  id: string
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function TableOfContents({ editor }: TableOfContentsProps) {
  const [headings, setHeadings] = useState<HeadingItem[]>([])

  useEffect(() => {
    if (!editor) return

    const update = () => {
      const items: HeadingItem[] = []
      editor.state.doc.descendants((node) => {
        if (node.type.name.startsWith('heading')) {
          const level = node.attrs.level || 1
          const text = node.textContent || ''
          const slug = slugify(text)
          const id = slug
            ? `heading-${slug}`
            : `heading-${Math.random().toString(36).slice(2, 11)}`
          items.push({ level, text, id })
        }
      })
      setHeadings(items)
    }

    editor.on('update', update)
    update()
    return () => {
      editor.off('update', update)
    }
  }, [editor])

  if (headings.length === 0) return null

  return (
    <nav aria-label="Table of contents" className="w-full">
      <ul className="!list-none !p-0 m-0">
        {headings.map((h, i) => (
          <li
            key={i}
            className="toc-item my-2 !list-none"
            style={{ paddingLeft: `${(h.level - 1) * 1.2}rem` }}
          >
            <a className={`toc-link toc-link-h${h.level}`} href={`#${h.id}`}>
              {h.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}

export default TableOfContents
