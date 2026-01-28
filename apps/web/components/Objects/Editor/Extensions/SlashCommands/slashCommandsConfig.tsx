import {
  AlertCircle,
  AlertTriangle,
  BadgeHelp,
  Code,
  Cuboid,
  FileText,
  Globe,
  GitBranch,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Heading6,
  ImagePlus,
  List,
  ListOrdered,
  MousePointerClick,
  Pilcrow,
  RotateCw,
  Sigma,
  Table,
  Tags,
  User,
  Video,
} from 'lucide-react'
import Image from 'next/image'
import lrnaiIcon from 'public/lrnai_icon.png'
import { SiYoutube } from '@icons-pack/react-simple-icons'
import { SlashCommandItem, SlashCommandCategory } from './types'
import React from 'react'

export const categoryLabels: Record<SlashCommandCategory, string> = {
  text: 'Text',
  media: 'Media',
  interactive: 'Interactive',
  callouts: 'Callouts',
  ui: 'UI Elements',
  tables: 'Tables',
}

export const categoryOrder: SlashCommandCategory[] = [
  'text',
  'media',
  'interactive',
  'callouts',
  'ui',
  'tables',
]

export const slashCommands: SlashCommandItem[] = [
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
    description: 'Section heading level 4',
    icon: <Heading4 size={18} />,
    category: 'text',
    keywords: ['heading', 'h4'],
    command: (editor) => {
      editor.chain().focus().toggleHeading({ level: 4 }).run()
    },
  },
  {
    id: 'heading5',
    title: 'Heading 5',
    description: 'Section heading level 5',
    icon: <Heading5 size={18} />,
    category: 'text',
    keywords: ['heading', 'h5'],
    command: (editor) => {
      editor.chain().focus().toggleHeading({ level: 5 }).run()
    },
  },
  {
    id: 'heading6',
    title: 'Heading 6',
    description: 'Section heading level 6',
    icon: <Heading6 size={18} />,
    category: 'text',
    keywords: ['heading', 'h6'],
    command: (editor) => {
      editor.chain().focus().toggleHeading({ level: 6 }).run()
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
    id: 'codeBlock',
    title: 'Code Block',
    description: 'Code snippet with syntax highlighting',
    icon: <Code size={18} />,
    category: 'text',
    keywords: ['code', 'snippet', 'programming', 'syntax'],
    command: (editor) => {
      editor.chain().focus().toggleCodeBlock().run()
    },
  },

  // Media category
  {
    id: 'image',
    title: 'Image',
    description: 'Upload or embed an image',
    icon: <ImagePlus size={18} />,
    category: 'media',
    keywords: ['image', 'picture', 'photo', 'upload'],
    command: (editor) => {
      editor.chain().focus().insertContent({ type: 'blockImage' }).run()
    },
  },
  {
    id: 'video',
    title: 'Video',
    description: 'Upload or embed a video',
    icon: <Video size={18} />,
    category: 'media',
    keywords: ['video', 'movie', 'upload', 'embed'],
    command: (editor) => {
      editor.chain().focus().insertContent({ type: 'blockVideo' }).run()
    },
  },
  {
    id: 'youtube',
    title: 'YouTube',
    description: 'Embed a YouTube video',
    icon: <SiYoutube size={18} />,
    category: 'media',
    keywords: ['youtube', 'video', 'embed', 'stream'],
    command: (editor) => {
      editor.chain().focus().insertContent({ type: 'blockEmbed' }).run()
    },
  },
  {
    id: 'pdf',
    title: 'PDF',
    description: 'Embed a PDF document',
    icon: <FileText size={18} />,
    category: 'media',
    keywords: ['pdf', 'document', 'file', 'embed'],
    command: (editor) => {
      editor.chain().focus().insertContent({ type: 'blockPDF' }).run()
    },
  },

  // Interactive category
  {
    id: 'magicBlock',
    title: 'Magic Block',
    description: 'Generate interactive content with AI',
    icon: <div style={{ background: 'conic-gradient(from 32deg at 53.75% 50%, rgb(35, 40, 93) 4deg, rgba(20, 0, 52, 0.95) 59deg, rgba(164, 45, 238, 0.88) 281deg)' }} className="p-1 rounded-md"><Image src={lrnaiIcon} alt="Magic Block" width={14} height={14} className="outline outline-1 outline-neutral-200/20 rounded" /></div>,
    category: 'interactive',
    keywords: ['magic', 'ai', 'interactive', 'simulation', 'chart', 'generate', 'create'],
    command: (editor) => {
      editor.chain().focus().insertContent({ type: 'blockMagic' }).run()
    },
  },
  {
    id: 'quiz',
    title: 'Quiz',
    description: 'Add an interactive quiz',
    icon: <BadgeHelp size={18} />,
    category: 'interactive',
    keywords: ['quiz', 'question', 'test', 'interactive'],
    command: (editor) => {
      editor.chain().focus().insertContent({ type: 'blockQuiz' }).run()
    },
  },
  {
    id: 'mathEquation',
    title: 'Math Equation',
    description: 'Add a LaTeX math equation',
    icon: <Sigma size={18} />,
    category: 'interactive',
    keywords: ['math', 'equation', 'latex', 'formula'],
    command: (editor) => {
      editor.chain().focus().insertContent({ type: 'blockMathEquation' }).run()
    },
  },
  {
    id: 'webPreview',
    title: 'Web Preview',
    description: 'Preview a web page',
    icon: <Globe size={18} />,
    category: 'interactive',
    keywords: ['web', 'preview', 'link', 'website', 'url'],
    command: (editor) => {
      editor.chain().focus().insertContent({ type: 'blockWebPreview' }).run()
    },
  },
  {
    id: 'flipcard',
    title: 'Flipcard',
    description: 'Add a flashcard for learning',
    icon: <RotateCw size={18} />,
    category: 'interactive',
    keywords: ['flipcard', 'flashcard', 'card', 'memory', 'learning'],
    command: (editor) => {
      editor.chain().focus().insertContent({
        type: 'flipcard',
        attrs: {
          question: 'Click to reveal the answer',
          answer: 'This is the answer',
          color: 'blue',
          alignment: 'center',
          size: 'medium',
        },
      }).run()
    },
  },
  {
    id: 'scenarios',
    title: 'Scenarios',
    description: 'Add interactive branching scenarios',
    icon: <GitBranch size={18} />,
    category: 'interactive',
    keywords: ['scenarios', 'branching', 'interactive', 'choice', 'story'],
    command: (editor) => {
      editor.chain().focus().insertContent({
        type: 'scenarios',
        attrs: {
          title: 'Interactive Scenario',
          scenarios: [
            {
              id: '1',
              text: 'Welcome to this interactive scenario. What would you like to do?',
              imageUrl: '',
              options: [
                { id: 'opt1', text: 'Continue exploring', nextScenarioId: '2' },
                { id: 'opt2', text: 'Learn more about the topic', nextScenarioId: '3' },
              ],
            },
            {
              id: '2',
              text: "Great choice! You are now exploring further. What's your next step?",
              imageUrl: '',
              options: [
                { id: 'opt3', text: 'Go back to start', nextScenarioId: '1' },
                { id: 'opt4', text: 'Finish scenario', nextScenarioId: null },
              ],
            },
            {
              id: '3',
              text: "Here's more information about the topic. This helps you understand better.",
              imageUrl: '',
              options: [
                { id: 'opt5', text: 'Go back to start', nextScenarioId: '1' },
                { id: 'opt6', text: 'Finish scenario', nextScenarioId: null },
              ],
            },
          ],
          currentScenarioId: '1',
        },
      }).run()
    },
  },

  // Callouts category
  {
    id: 'infoCallout',
    title: 'Info Callout',
    description: 'Highlight important information',
    icon: <AlertCircle size={18} />,
    category: 'callouts',
    keywords: ['info', 'callout', 'note', 'information', 'highlight'],
    command: (editor) => {
      editor.chain().focus().toggleNode('calloutInfo', 'paragraph').run()
    },
  },
  {
    id: 'warningCallout',
    title: 'Warning Callout',
    description: 'Highlight a warning message',
    icon: <AlertTriangle size={18} />,
    category: 'callouts',
    keywords: ['warning', 'callout', 'alert', 'caution', 'danger'],
    command: (editor) => {
      editor.chain().focus().toggleNode('calloutWarning', 'paragraph').run()
    },
  },

  // UI Elements category
  {
    id: 'badge',
    title: 'Badge',
    description: 'Add a badge element',
    icon: <Tags size={18} />,
    category: 'ui',
    keywords: ['badge', 'tag', 'label', 'chip'],
    command: (editor) => {
      editor.chain().focus().insertContent({
        type: 'badge',
        content: [{ type: 'text', text: 'This is a Badge' }],
      }).run()
    },
  },
  {
    id: 'button',
    title: 'Button',
    description: 'Add a clickable button',
    icon: <MousePointerClick size={18} />,
    category: 'ui',
    keywords: ['button', 'click', 'action', 'cta'],
    command: (editor) => {
      editor.chain().focus().insertContent({
        type: 'button',
        content: [{ type: 'text', text: 'Click me' }],
      }).run()
    },
  },
  {
    id: 'user',
    title: 'User',
    description: 'Reference a user',
    icon: <User size={18} />,
    category: 'ui',
    keywords: ['user', 'mention', 'person', 'profile'],
    command: (editor) => {
      editor.chain().focus().insertContent({ type: 'blockUser' }).run()
    },
  },
  {
    id: 'embed',
    title: 'Embed',
    description: 'Embed external content',
    icon: <Cuboid size={18} />,
    category: 'ui',
    keywords: ['embed', 'external', 'iframe', 'widget'],
    command: (editor) => {
      editor.chain().focus().insertContent({ type: 'blockEmbed' }).run()
    },
  },

  // Tables category
  {
    id: 'table',
    title: 'Table',
    description: 'Insert a 3x3 table',
    icon: <Table size={18} />,
    category: 'tables',
    keywords: ['table', 'grid', 'rows', 'columns', 'data'],
    command: (editor) => {
      editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
    },
  },
]

export function filterCommands(query: string): SlashCommandItem[] {
  if (!query) return slashCommands

  const lowerQuery = query.toLowerCase()
  return slashCommands.filter(
    (item) =>
      item.title.toLowerCase().includes(lowerQuery) ||
      item.description.toLowerCase().includes(lowerQuery) ||
      item.keywords.some((keyword) => keyword.toLowerCase().includes(lowerQuery))
  )
}

export function groupCommandsByCategory(
  commands: SlashCommandItem[]
): Map<SlashCommandCategory, SlashCommandItem[]> {
  const grouped = new Map<SlashCommandCategory, SlashCommandItem[]>()

  for (const category of categoryOrder) {
    const items = commands.filter((cmd) => cmd.category === category)
    if (items.length > 0) {
      grouped.set(category, items)
    }
  }

  return grouped
}
