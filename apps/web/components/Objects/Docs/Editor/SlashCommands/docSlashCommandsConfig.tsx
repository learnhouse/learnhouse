import {
  AlertCircle,
  AlertTriangle,
  CheckCircle,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  ImagePlus,
  Lightbulb,
  List,
  ListOrdered,
  Minus,
  Pilcrow,
  Quote,
  Table,
} from 'lucide-react'
import { DocSlashCommandItem, DocSlashCommandCategory } from './types'
import React from 'react'

export const categoryLabels: Record<DocSlashCommandCategory, string> = {
  text: 'Text',
  blocks: 'Blocks',
  insert: 'Insert',
  media: 'Media',
}

export const categoryOrder: DocSlashCommandCategory[] = [
  'text',
  'blocks',
  'insert',
  'media',
]

export const docSlashCommands: DocSlashCommandItem[] = [
  // Text category
  {
    id: 'paragraph',
    title: 'Paragraph',
    description: 'Plain text paragraph',
    icon: <Pilcrow size={18} />,
    category: 'text',
    keywords: ['paragraph', 'text', 'plain', 'normal'],
    command: (editor) => {
      editor.chain().focus().setParagraph().run()
    },
  },
  {
    id: 'heading1',
    title: 'Heading 1',
    description: 'Large section heading',
    icon: <Heading1 size={18} />,
    category: 'text',
    keywords: ['heading', 'h1', 'title', 'large'],
    command: (editor) => {
      editor.chain().focus().toggleHeading({ level: 1 }).run()
    },
  },
  {
    id: 'heading2',
    title: 'Heading 2',
    description: 'Medium section heading',
    icon: <Heading2 size={18} />,
    category: 'text',
    keywords: ['heading', 'h2', 'subtitle', 'medium'],
    command: (editor) => {
      editor.chain().focus().toggleHeading({ level: 2 }).run()
    },
  },
  {
    id: 'heading3',
    title: 'Heading 3',
    description: 'Small section heading',
    icon: <Heading3 size={18} />,
    category: 'text',
    keywords: ['heading', 'h3', 'small'],
    command: (editor) => {
      editor.chain().focus().toggleHeading({ level: 3 }).run()
    },
  },
  {
    id: 'heading4',
    title: 'Heading 4',
    description: 'Sub-section heading',
    icon: <Heading4 size={18} />,
    category: 'text',
    keywords: ['heading', 'h4'],
    command: (editor) => {
      editor.chain().focus().toggleHeading({ level: 4 }).run()
    },
  },
  {
    id: 'bulletList',
    title: 'Bullet List',
    description: 'Unordered list with bullet points',
    icon: <List size={18} />,
    category: 'text',
    keywords: ['bullet', 'list', 'unordered', 'ul'],
    command: (editor) => {
      editor.chain().focus().toggleBulletList().run()
    },
  },
  {
    id: 'orderedList',
    title: 'Ordered List',
    description: 'Numbered list',
    icon: <ListOrdered size={18} />,
    category: 'text',
    keywords: ['ordered', 'list', 'numbered', 'ol'],
    command: (editor) => {
      editor.chain().focus().toggleOrderedList().run()
    },
  },
  {
    id: 'blockquote',
    title: 'Blockquote',
    description: 'Block quote',
    icon: <Quote size={18} />,
    category: 'text',
    keywords: ['blockquote', 'quote', 'citation'],
    command: (editor) => {
      editor.chain().focus().toggleBlockquote().run()
    },
  },
  {
    id: 'codeBlock',
    title: 'Code Block',
    description: 'Code with syntax highlighting',
    icon: <Code size={18} />,
    category: 'text',
    keywords: ['code', 'snippet', 'programming', 'syntax'],
    command: (editor) => {
      editor.chain().focus().toggleCodeBlock().run()
    },
  },

  // Blocks category (callouts)
  {
    id: 'infoCallout',
    title: 'Info Callout',
    description: 'Highlight important information',
    icon: <AlertCircle size={18} className="text-blue-500" />,
    category: 'blocks',
    keywords: ['info', 'callout', 'note', 'information'],
    command: (editor) => {
      editor.chain().focus().setDocCallout({ variant: 'info' }).run()
    },
  },
  {
    id: 'warningCallout',
    title: 'Warning Callout',
    description: 'Highlight a warning message',
    icon: <AlertTriangle size={18} className="text-amber-500" />,
    category: 'blocks',
    keywords: ['warning', 'callout', 'alert', 'caution'],
    command: (editor) => {
      editor.chain().focus().setDocCallout({ variant: 'warning' }).run()
    },
  },
  {
    id: 'successCallout',
    title: 'Success Callout',
    description: 'Highlight a success message',
    icon: <CheckCircle size={18} className="text-green-500" />,
    category: 'blocks',
    keywords: ['success', 'callout', 'done', 'complete'],
    command: (editor) => {
      editor.chain().focus().setDocCallout({ variant: 'success' }).run()
    },
  },
  {
    id: 'tipCallout',
    title: 'Tip Callout',
    description: 'Share a helpful tip',
    icon: <Lightbulb size={18} className="text-purple-500" />,
    category: 'blocks',
    keywords: ['tip', 'callout', 'hint', 'suggestion'],
    command: (editor) => {
      editor.chain().focus().setDocCallout({ variant: 'tip' }).run()
    },
  },

  // Insert category
  {
    id: 'horizontalRule',
    title: 'Horizontal Rule',
    description: 'Divider line',
    icon: <Minus size={18} />,
    category: 'insert',
    keywords: ['horizontal', 'rule', 'divider', 'line', 'separator'],
    command: (editor) => {
      editor.chain().focus().setHorizontalRule().run()
    },
  },
  {
    id: 'table',
    title: 'Table',
    description: 'Insert a 3x3 table',
    icon: <Table size={18} />,
    category: 'insert',
    keywords: ['table', 'grid', 'rows', 'columns'],
    command: (editor) => {
      editor
        .chain()
        .focus()
        .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
        .run()
    },
  },

  // Media category
  {
    id: 'image',
    title: 'Image',
    description: 'Insert image from URL',
    icon: <ImagePlus size={18} />,
    category: 'media',
    keywords: ['image', 'picture', 'photo', 'url'],
    command: (editor) => {
      editor.chain().focus().setDocImage().run()
    },
  },
]

export function filterDocCommands(query: string): DocSlashCommandItem[] {
  if (!query) return docSlashCommands

  const lowerQuery = query.toLowerCase()
  return docSlashCommands.filter(
    (item) =>
      item.title.toLowerCase().includes(lowerQuery) ||
      item.description.toLowerCase().includes(lowerQuery) ||
      item.keywords.some((keyword) =>
        keyword.toLowerCase().includes(lowerQuery)
      )
  )
}

export function groupDocCommandsByCategory(
  commands: DocSlashCommandItem[]
): Map<DocSlashCommandCategory, DocSlashCommandItem[]> {
  const grouped = new Map<DocSlashCommandCategory, DocSlashCommandItem[]>()

  for (const category of categoryOrder) {
    const items = commands.filter((cmd) => cmd.category === category)
    if (items.length > 0) {
      grouped.set(category, items)
    }
  }

  return grouped
}
