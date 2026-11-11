import {
  AlertCircle,
  Braces,
  CalendarClock,
  SplitSquareHorizontal,
  Users,
  LayoutTemplate,
  Save,
  Split,
  BadgeHelp,
  Code,
  CodeSquare,
  Cuboid,
  FileText,
  Globe,
  GitBranch,
  Grid2x2,
  Headphones,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Heading6,
  ImagePlus,
  Library,
  List,
  ListOrdered,
  Minus,
  MousePointerClick,
  Pilcrow,
  Puzzle,
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
import i18n from '@/lib/i18n'
import { searchMatchesAny, normalizeForSearch } from '@/lib/search/normalize'
import { EDITOR_EVENTS, emitEditorEvent } from '../../Templates/templateContent'
import { presetById } from '../Dynamic/dynamicRules'

export const categoryLabelKeys: Record<SlashCommandCategory, string> = {
  text: 'editor.slash_menu.categories.text',
  media: 'editor.slash_menu.categories.media',
  interactive: 'editor.slash_menu.categories.interactive',
  callouts: 'editor.slash_menu.categories.callouts',
  dynamic: 'editor.slash_menu.categories.dynamic',
  ui: 'editor.slash_menu.categories.ui',
  tables: 'editor.slash_menu.categories.tables',
}

export const categoryOrder: SlashCommandCategory[] = [
  'text',
  'media',
  'interactive',
  'callouts',
  'dynamic',
  'ui',
  'tables',
]

export const slashCommands: SlashCommandItem[] = [
  // Text category
  {
    id: 'paragraph',
    title: 'Paragraph',
    description: 'Plain text paragraph',
    titleKey: 'editor.slash_menu.items.paragraph.title',
    descriptionKey: 'editor.slash_menu.items.paragraph.description',
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
    titleKey: 'editor.slash_menu.items.heading1.title',
    descriptionKey: 'editor.slash_menu.items.heading1.description',
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
    titleKey: 'editor.slash_menu.items.heading2.title',
    descriptionKey: 'editor.slash_menu.items.heading2.description',
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
    titleKey: 'editor.slash_menu.items.heading3.title',
    descriptionKey: 'editor.slash_menu.items.heading3.description',
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
    titleKey: 'editor.slash_menu.items.heading4.title',
    descriptionKey: 'editor.slash_menu.items.heading4.description',
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
    titleKey: 'editor.slash_menu.items.heading5.title',
    descriptionKey: 'editor.slash_menu.items.heading5.description',
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
    titleKey: 'editor.slash_menu.items.heading6.title',
    descriptionKey: 'editor.slash_menu.items.heading6.description',
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
    titleKey: 'editor.slash_menu.items.bullet_list.title',
    descriptionKey: 'editor.slash_menu.items.bullet_list.description',
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
    titleKey: 'editor.slash_menu.items.ordered_list.title',
    descriptionKey: 'editor.slash_menu.items.ordered_list.description',
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
    titleKey: 'editor.slash_menu.items.code_block.title',
    descriptionKey: 'editor.slash_menu.items.code_block.description',
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
    titleKey: 'editor.slash_menu.items.image.title',
    descriptionKey: 'editor.slash_menu.items.image.description',
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
    titleKey: 'editor.slash_menu.items.video.title',
    descriptionKey: 'editor.slash_menu.items.video.description',
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
    titleKey: 'editor.slash_menu.items.youtube.title',
    descriptionKey: 'editor.slash_menu.items.youtube.description',
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
    titleKey: 'editor.slash_menu.items.pdf.title',
    descriptionKey: 'editor.slash_menu.items.pdf.description',
    icon: <FileText size={18} />,
    category: 'media',
    keywords: ['pdf', 'document', 'file', 'embed'],
    command: (editor) => {
      editor.chain().focus().insertContent({ type: 'blockPDF' }).run()
    },
  },
  {
    id: 'audio',
    title: 'Audio',
    description: 'Upload audio or embed a podcast',
    titleKey: 'editor.slash_menu.items.audio.title',
    descriptionKey: 'editor.slash_menu.items.audio.description',
    icon: <Headphones size={18} />,
    category: 'media',
    keywords: ['audio', 'music', 'sound', 'podcast', 'mp3', 'episode'],
    command: (editor) => {
      editor.chain().focus().insertContent({ type: 'blockAudio' }).run()
    },
  },
  {
    id: 'library',
    title: 'Library',
    description: 'Insert a file or resource from your Library',
    titleKey: 'editor.slash_menu.items.library.title',
    descriptionKey: 'editor.slash_menu.items.library.description',
    icon: <Library size={18} />,
    category: 'media',
    keywords: ['library', 'file', 'media', 'resource', 'reuse', 'existing', 'folder'],
    command: (editor) => {
      editor.chain().focus().insertContent({ type: 'blockLibrary' }).run()
    },
  },

  // Interactive category
  {
    id: 'magicBlock',
    title: 'Magic Block',
    description: 'Generate interactive content with AI',
    titleKey: 'editor.slash_menu.items.magic_block.title',
    descriptionKey: 'editor.slash_menu.items.magic_block.description',
    icon: <div style={{ background: 'conic-gradient(from 32deg at 53.75% 50%, rgb(35, 40, 93) 4deg, rgba(20, 0, 52, 0.95) 59deg, rgba(164, 45, 238, 0.88) 281deg)' }} className="p-1 rounded-md"><Image src={lrnaiIcon} alt={i18n.t('editor.blocks.magic_block_content.title')} width={14} height={14} className="outline outline-1 outline-neutral-200/20 rounded" /></div>,
    category: 'interactive',
    keywords: ['magic', 'ai', 'interactive', 'simulation', 'chart', 'generate', 'create'],
    command: (editor) => {
      editor.chain().focus().insertContent({ type: 'blockMagic' }).run()
    },
    requiredPlan: 'standard',
  },
  {
    id: 'quiz',
    title: 'Quiz',
    description: 'Add an interactive quiz',
    titleKey: 'editor.slash_menu.items.quiz.title',
    descriptionKey: 'editor.slash_menu.items.quiz.description',
    icon: <BadgeHelp size={18} />,
    category: 'interactive',
    keywords: ['quiz', 'question', 'test', 'interactive'],
    command: (editor) => {
      editor.chain().focus().insertContent({ type: 'blockQuiz' }).run()
    },
  },
  {
    id: 'h5p',
    title: 'H5P',
    description: 'Embed interactive H5P content by URL',
    titleKey: 'editor.slash_menu.items.h5p.title',
    descriptionKey: 'editor.slash_menu.items.h5p.description',
    icon: <Puzzle size={18} />,
    category: 'interactive',
    keywords: ['h5p', 'interactive', 'embed', 'lumi', 'moodle', 'hvp', 'activity'],
    command: (editor) => {
      editor.chain().focus().insertContent({ type: 'blockH5P' }).run()
    },
  },
  {
    id: 'mathEquation',
    title: 'Math Equation',
    description: 'Add a LaTeX math equation',
    titleKey: 'editor.slash_menu.items.math_equation.title',
    descriptionKey: 'editor.slash_menu.items.math_equation.description',
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
    titleKey: 'editor.slash_menu.items.web_preview.title',
    descriptionKey: 'editor.slash_menu.items.web_preview.description',
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
    titleKey: 'editor.slash_menu.items.flipcard.title',
    descriptionKey: 'editor.slash_menu.items.flipcard.description',
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
    id: 'flipcardGrid',
    title: 'Flashcard Grid',
    description: 'Lay several flashcards out side by side',
    titleKey: 'editor.slash_menu.items.flipcard_grid.title',
    descriptionKey: 'editor.slash_menu.items.flipcard_grid.description',
    icon: <Grid2x2 size={18} />,
    category: 'interactive',
    keywords: ['flipcard', 'flashcard', 'grid', 'columns', 'row', 'horizontal', 'deck'],
    command: (editor) => {
      const card = (question: string, answer: string) => ({
        type: 'flipcard',
        attrs: { question, answer, color: 'blue', alignment: 'center', size: 'medium' },
      })
      editor.chain().focus().insertContent({
        type: 'flipcardGrid',
        attrs: { columns: 2 },
        content: [
          card('Click to reveal the answer', 'This is the answer'),
          card('Click to reveal the answer', 'This is the answer'),
        ],
      }).run()
    },
  },
  {
    id: 'codePlayground',
    title: 'Code Playground',
    description: 'Add a coding challenge with test cases',
    titleKey: 'editor.slash_menu.items.code_playground.title',
    descriptionKey: 'editor.slash_menu.items.code_playground.description',
    icon: <CodeSquare size={18} />,
    category: 'interactive',
    keywords: ['code', 'playground', 'coding', 'challenge', 'judge', 'execute', 'run', 'programming'],
    command: (editor) => {
      editor.chain().focus().insertContent({
        type: 'blockCode',
        attrs: {
          mode: 'advanced',
          languageId: 71,
          languageName: 'Python 3',
          starterCode: '# Write your code here\n',
          testCases: [],
          description: '',
          hints: [],
          difficulty: 'medium',
          solutionCode: '',
          maxAttemptsBeforeReveal: 3,
          timeComplexity: '',
          spaceComplexity: '',
          timeLimitMs: 10000,
        },
      }).run()
    },
  },
  {
    id: 'scenarios',
    title: 'Scenarios',
    description: 'Add interactive branching scenarios',
    titleKey: 'editor.slash_menu.items.scenarios.title',
    descriptionKey: 'editor.slash_menu.items.scenarios.description',
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
    id: 'callout',
    title: 'Callout',
    description: 'Info, warning, tip, success or error block',
    titleKey: 'editor.slash_menu.items.callout.title',
    descriptionKey: 'editor.slash_menu.items.callout.description',
    icon: <AlertCircle size={18} />,
    category: 'callouts',
    keywords: ['callout', 'info', 'warning', 'tip', 'success', 'error', 'note', 'alert'],
    command: (editor) => {
      editor.chain().focus().insertContent({
        type: 'callout',
        attrs: { type: 'info' },
        content: [{ type: 'paragraph' }],
      }).run()
    },
  },

  // UI Elements category
  {
    id: 'divider',
    title: 'Divider',
    description: 'Horizontal line to separate sections',
    titleKey: 'editor.slash_menu.items.divider.title',
    descriptionKey: 'editor.slash_menu.items.divider.description',
    icon: <Minus size={18} />,
    category: 'ui',
    keywords: ['divider', 'separator', 'rule', 'line', 'hr', 'horizontal', 'break', 'split'],
    command: (editor) => {
      editor.chain().focus().setHorizontalRule().run()
    },
  },
  {
    id: 'badge',
    title: 'Badge',
    description: 'Add a badge element',
    titleKey: 'editor.slash_menu.items.badge.title',
    descriptionKey: 'editor.slash_menu.items.badge.description',
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
    titleKey: 'editor.slash_menu.items.button.title',
    descriptionKey: 'editor.slash_menu.items.button.description',
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
    titleKey: 'editor.slash_menu.items.user.title',
    descriptionKey: 'editor.slash_menu.items.user.description',
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
    titleKey: 'editor.slash_menu.items.embed.title',
    descriptionKey: 'editor.slash_menu.items.embed.description',
    icon: <Cuboid size={18} />,
    category: 'ui',
    keywords: ['embed', 'external', 'iframe', 'widget'],
    command: (editor) => {
      editor.chain().focus().insertContent({ type: 'blockEmbed' }).run()
    },
  },

  // Dynamic content category
  {
    id: 'variable',
    title: 'Variable',
    description: "Learner's name, course name, progress…",
    titleKey: 'editor.slash_menu.items.variable.title',
    descriptionKey: 'editor.slash_menu.items.variable.description',
    icon: <Braces size={18} />,
    category: 'dynamic',
    keywords: ['variable', 'placeholder', 'name', 'personalize', 'dynamic', 'template', '{{'],
    command: (editor) => {
      editor.chain().focus().insertDynamicVariable().run()
    },
  },
  {
    id: 'conditional',
    title: 'Conditional content',
    description: 'Show blocks only to some learners',
    titleKey: 'editor.slash_menu.items.conditional.title',
    descriptionKey: 'editor.slash_menu.items.conditional.description',
    icon: <Split size={18} />,
    category: 'dynamic',
    keywords: ['conditional', 'condition', 'rule', 'audience', 'group', 'show', 'hide', 'personalize', 'drip'],
    command: (editor) => {
      editor.chain().focus().insertConditionalBlock().run()
    },
  },
  {
    id: 'show-to-group',
    title: 'Show to a group',
    description: 'Content only members of a user group see',
    titleKey: 'editor.slash_menu.items.show_to_group.title',
    descriptionKey: 'editor.slash_menu.items.show_to_group.description',
    icon: <Users size={18} />,
    category: 'dynamic',
    keywords: ['group', 'team', 'audience', 'members', 'only', 'restrict', 'personalize'],
    command: (editor) => {
      const preset = presetById('group')!
      editor.chain().focus().insertConditionalBlock({ rules: preset.rules(), openRules: true }).run()
    },
  },
  {
    id: 'drip',
    title: 'Unlock later',
    description: 'Show content after days in the course',
    titleKey: 'editor.slash_menu.items.drip.title',
    descriptionKey: 'editor.slash_menu.items.drip.description',
    icon: <CalendarClock size={18} />,
    category: 'dynamic',
    keywords: ['drip', 'unlock', 'later', 'schedule', 'days', 'week', 'release'],
    command: (editor) => {
      const preset = presetById('drip')!
      editor
        .chain()
        .focus()
        .insertConditionalBlock({ rules: preset.rules(), hiddenMessage: preset.hiddenMessage, label: 'After a week', openRules: true })
        .run()
    },
  },
  {
    id: 'ab-test',
    title: 'A/B test',
    description: 'Two versions, each shown to half of learners',
    titleKey: 'editor.slash_menu.items.ab_test.title',
    descriptionKey: 'editor.slash_menu.items.ab_test.description',
    icon: <SplitSquareHorizontal size={18} />,
    category: 'dynamic',
    keywords: ['ab', 'a/b', 'test', 'experiment', 'variant', 'split', 'version'],
    command: (editor) => {
      editor.chain().focus().insertABTest().run()
    },
  },
  {
    id: 'insert-template',
    title: 'Insert template',
    description: 'Reuse saved blocks or pages',
    titleKey: 'editor.slash_menu.items.insert_template.title',
    descriptionKey: 'editor.slash_menu.items.insert_template.description',
    icon: <LayoutTemplate size={18} />,
    category: 'dynamic',
    keywords: ['template', 'reuse', 'snippet', 'saved', 'library'],
    command: () => emitEditorEvent(EDITOR_EVENTS.openTemplates),
  },
  {
    id: 'save-template',
    title: 'Save as template',
    description: 'Save the selection or page for reuse',
    titleKey: 'editor.slash_menu.items.save_template.title',
    descriptionKey: 'editor.slash_menu.items.save_template.description',
    icon: <Save size={18} />,
    category: 'dynamic',
    keywords: ['template', 'save', 'reuse', 'snippet'],
    command: () => emitEditorEvent(EDITOR_EVENTS.saveTemplate),
  },

  // Tables category
  {
    id: 'table',
    title: 'Table',
    description: 'Insert a 3x3 table',
    titleKey: 'editor.slash_menu.items.table.title',
    descriptionKey: 'editor.slash_menu.items.table.description',
    icon: <Table size={18} />,
    category: 'tables',
    keywords: ['table', 'grid', 'rows', 'columns', 'data'],
    command: (editor) => {
      editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
    },
  },
]

export function filterCommands(query: string): SlashCommandItem[] {
  const matches = query
    ? slashCommands.filter(
        (item) =>
          searchMatchesAny([item.title, item.description, i18n.t(item.titleKey), i18n.t(item.descriptionKey)], query) ||
          item.keywords.some((keyword) => normalizeForSearch(keyword).includes(normalizeForSearch(query)))
      )
    : slashCommands
  // The menu draws items grouped by category but picks them by position in
  // this list (keyboard and click), so return them in that same order.
  return categoryOrder.flatMap((category) => matches.filter((item) => item.category === category))
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
