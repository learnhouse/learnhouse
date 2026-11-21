'use client'
/*
 The light editor: a small editable copy of a few blocks of the page.

 It runs the learner schema (getActivityExtensions, shared with the
 renderers) without the "no text input" filter, inside an editable
 EditorOptionsProvider. Every block reads its editability from that context,
 so each one shows the same editing UI as in the full editor (quiz builder,
 callout picker, image settings, code language…): nothing here knows about
 any particular block, and a block added to the learner schema (Experiences,
 Editor Plus) is editable here without changes.

 Text gets the full editor's selection menu (marks, headings, lists, links),
 minus AI and comments.
*/
import React from 'react'
import dynamic from 'next/dynamic'
import { EditorContent, useEditor } from '@tiptap/react'
import EditorOptionsProvider from '@components/Contexts/Editor/EditorContext'
import { getActivityExtensions } from '@components/Objects/Activities/DynamicCanva/activityExtensions'
import BlockThemeScope from '@components/Objects/Activities/BlockTheme/BlockThemeScope'
import type { JSONNode } from './contributionModel'

const SelectionBubble = dynamic(() => import('@components/Objects/Editor/Blocks/bubble/SelectionBubble'), {
  ssr: false,
  loading: () => null,
})

export type LightEditorHandle = { getBlocks: () => JSONNode[] }

type Props = {
  blocks: JSONNode[]
  activity: any
  courseUuid?: string
  orgUuid?: string
  textMode: boolean
  onChange?: (blocks: JSONNode[]) => void
  ariaLabel: string
}

const LightEditor = React.forwardRef<LightEditorHandle, Props>(function LightEditor(
  { blocks, activity, courseUuid, orgUuid, textMode, onChange, ariaLabel },
  ref
) {
  // Built once: the editor is remounted (keyed) when the range changes.
  const extensions = React.useMemo(
    () => getActivityExtensions({ activity, courseUuid, orgUuid }).filter((e: any) => e?.name !== 'noTextInput'),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )
  const initial = React.useMemo(() => ({ type: 'doc', content: blocks.length ? blocks : [{ type: 'paragraph' }] }), [blocks])
  const editor = useEditor({
    immediatelyRender: false,
    editable: true,
    extensions,
    content: initial,
    editorProps: {
      attributes: {
        'aria-label': ariaLabel,
        class: 'lh-light-editor focus:outline-none min-h-[3rem]',
      },
    },
    onUpdate: ({ editor: e }) => onChange?.((e.getJSON().content ?? []) as JSONNode[]),
  })

  React.useImperativeHandle(ref, () => ({
    getBlocks: () => ((editor?.getJSON().content ?? []) as JSONNode[]),
  }), [editor])

  React.useEffect(() => {
    if (editor && textMode) editor.commands.focus('end')
  }, [editor, textMode])

  return (
    <EditorOptionsProvider options={{ isEditable: true, allowAI: false }}>
      <BlockThemeScope className="w-full">
        <div className="canva-content-wrapper" data-lesson-content="">
          <EditorContent editor={editor} />
          {editor && textMode && <SelectionBubble editor={editor} activity={activity} allowAI={false} />}
        </div>
      </BlockThemeScope>
    </EditorOptionsProvider>
  )
})

export default LightEditor
