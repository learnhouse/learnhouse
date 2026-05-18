'use client'

import { useMemo } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Youtube from '@tiptap/extension-youtube'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { Table } from '@tiptap/extension-table'
import TableHeader from '@tiptap/extension-table-header'
import TableRow from '@tiptap/extension-table-row'
import TableCell from '@tiptap/extension-table-cell'

import { CustomHeading } from '../../extensions/CustomHeading'
import { getLinkExtension } from '../../extensions/link'
import { lowlight } from '../../extensions/lowlight'
import ImageBlock from '../../extensions/Image/ImageBlock'
import VideoBlock from '../../extensions/Video/VideoBlock'
import AudioBlock from '../../extensions/Audio/AudioBlock'
import PDFBlock from '../../extensions/PDF/PDFBlock'
import { Callout, InfoCallout, WarningCallout } from '../../extensions/Callout/Callout'
import MathEquationBlock from '../../extensions/MathEquation/MathEquationBlock'
import EmbedObjects from '../../extensions/EmbedObjects/EmbedObjects'
import QuizBlock from '../../extensions/Quiz/QuizBlock'
import Badges from '../../extensions/Badges/Badges'
import Buttons from '../../extensions/Buttons/Buttons'
import { fallbackExtensions } from '../../extensions/Fallbacks/Fallbacks'
import TableOfContents from './TableOfContents'

function normalizeMarkTypes(content: any): any {
  if (!content || typeof content !== 'object') return content
  if (Array.isArray(content)) return content.map(normalizeMarkTypes)
  const out: any = { ...content }
  if (Array.isArray(out.marks)) {
    out.marks = out.marks.map((mark: any) => {
      if (mark.type === 'strong') return { ...mark, type: 'bold' }
      if (mark.type === 'em') return { ...mark, type: 'italic' }
      return mark
    })
  }
  if (Array.isArray(out.content)) out.content = normalizeMarkTypes(out.content)
  return out
}

export interface DynamicCanvaProps {
  content: any
  activity: { activity_uuid?: string; [k: string]: any }
  hideTableOfContents?: boolean
}

export function DynamicCanva({ content, activity, hideTableOfContents }: DynamicCanvaProps) {
  const normalizedContent = useMemo(() => {
    if (!content) return content
    try {
      const parsed = typeof content === 'string' ? JSON.parse(content) : content
      return normalizeMarkTypes(parsed)
    } catch {
      return content
    }
  }, [content])

  const editor = useEditor({
    immediatelyRender: false,
    editable: false,
    content: normalizedContent,
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: false,
        link: false,
      }),
      CustomHeading.configure({ levels: [1, 2, 3, 4, 5, 6] }),
      getLinkExtension(),
      CodeBlockLowlight.configure({ lowlight }),
      Youtube.configure({ controls: true, nocookie: true, modestBranding: true }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      ImageBlock.configure({ activity }),
      VideoBlock.configure({ activity }),
      AudioBlock.configure({ activity }),
      PDFBlock.configure({ activity }),
      Callout,
      InfoCallout,
      WarningCallout,
      MathEquationBlock,
      EmbedObjects,
      QuizBlock,
      Badges,
      Buttons,
      ...fallbackExtensions,
    ],
  })

  return (
    <div className="learnhouse-reader">
      {!hideTableOfContents && (
        <div className="learnhouse-reader-toc mb-6">
          <TableOfContents editor={editor} />
        </div>
      )}
      <EditorContent editor={editor} />
    </div>
  )
}

export default DynamicCanva
