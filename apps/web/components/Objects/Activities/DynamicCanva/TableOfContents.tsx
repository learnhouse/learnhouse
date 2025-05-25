import { useEffect, useState } from 'react'
import styled from 'styled-components'
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
    <TOCCard>
      <TOCList>
        {headings.map((heading, index) => (
          <TOCItem key={index} level={heading.level}>
            <span className="toc-check"><Check size={15} strokeWidth={1.7} /></span>
            <a className={`toc-link toc-link-h${heading.level}`} href={`#${heading.id}`}>{heading.text}</a>
          </TOCItem>
        ))}
      </TOCList>
    </TOCCard>
  )
}

const TOCCard = styled.div`
  width: 20%;
  background: none;
  border: none;
  box-shadow: none;
  padding: 0;
  margin: 0;
  font-family: inherit;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  height: fit-content;
`

const TOCList = styled.ul`
  list-style: none !important;
  padding: 0 !important;
  margin: 0;
`

const TOCItem = styled.li<{ level: number }>`
  margin: 0.5rem 0;
  padding-left: ${({ level }) => `${(level - 1) * 1.2}rem`};
  list-style: none !important;
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;

  .toc-check {
    display: flex;
    align-items: center;
    color: #23272f;
    flex-shrink: 0;
    margin-top: 0.1rem;
  }

  .toc-link {
    color: #23272f;
    text-decoration: none;
    display: block;
    font-size: ${({ level }) => (level === 1 ? '1rem' : level === 2 ? '0.97rem' : '0.95rem')};
    font-weight: ${({ level }) => (level === 1 ? 500 : 400)};
    line-height: 1.4;
    padding: 0;
    background: none;
    border-radius: 0;
    transition: none;
    flex: 1;
    min-width: 0;
    word-break: break-word;
    hyphens: auto;
    
    &:hover {
      color: #007acc;
    }
  }
`

export default TableOfContents 