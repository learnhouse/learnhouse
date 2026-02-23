import { useMemo } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Youtube from '@tiptap/extension-youtube'

/**
 * Transforms ProseMirror JSON content to fix mark type names.
 * TipTap uses 'bold'/'italic' but AI sometimes generates 'strong'/'em'.
 */
function normalizeMarkTypes(content: any): any {
  if (!content || typeof content !== 'object') return content;
  if (Array.isArray(content)) return content.map(normalizeMarkTypes);

  const normalized: any = { ...content };
  if (normalized.marks && Array.isArray(normalized.marks)) {
    normalized.marks = normalized.marks.map((mark: any) => {
      if (mark.type === 'strong') return { ...mark, type: 'bold' };
      if (mark.type === 'em') return { ...mark, type: 'italic' };
      return mark;
    });
  }
  if (normalized.content && Array.isArray(normalized.content)) {
    normalized.content = normalizeMarkTypes(normalized.content);
  }
  return normalized;
}
// Custom Extensions
import InfoCallout from '@components/Objects/Editor/Extensions/Callout/Info/InfoCallout'
import WarningCallout from '@components/Objects/Editor/Extensions/Callout/Warning/WarningCallout'
import ImageBlock from '@components/Objects/Editor/Extensions/Image/ImageBlock'
import VideoBlock from '@components/Objects/Editor/Extensions/Video/VideoBlock'
import AudioBlock from '@components/Objects/Editor/Extensions/Audio/AudioBlock'
import MathEquationBlock from '@components/Objects/Editor/Extensions/MathEquation/MathEquationBlock'
import PDFBlock from '@components/Objects/Editor/Extensions/PDF/PDFBlock'
import QuizBlock from '@components/Objects/Editor/Extensions/Quiz/QuizBlock'
import MagicBlock from '@components/Objects/Editor/Extensions/MagicBlocks/MagicBlock'

// Lowlight — `common` already includes css, javascript, typescript, xml, python, java
import { common, createLowlight } from 'lowlight'
const lowlight = createLowlight(common)
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { NoTextInput } from '@components/Objects/Editor/Extensions/NoTextInput/NoTextInput'
import EditorOptionsProvider from '@components/Contexts/Editor/EditorContext'
import EmbedObjects from '@components/Objects/Editor/Extensions/EmbedObjects/EmbedObjects'
import Badges from '@components/Objects/Editor/Extensions/Badges/Badges'
import Buttons from '@components/Objects/Editor/Extensions/Buttons/Buttons'
import Flipcard from '@components/Objects/Editor/Extensions/Flipcard/Flipcard'
import Scenarios from '@components/Objects/Editor/Extensions/Scenarios/Scenarios'
import CodePlayground from '@components/Objects/Editor/Extensions/CodePlayground/CodePlayground'
import { Table } from '@tiptap/extension-table'
import TableHeader from '@tiptap/extension-table-header'
import TableRow from '@tiptap/extension-table-row'
import TableCell from '@tiptap/extension-table-cell'
import UserBlock from '@components/Objects/Editor/Extensions/Users/UserBlock'
import { getLinkExtension } from '@components/Objects/Editor/EditorConf'
import TableOfContents from './TableOfContents'
import { CustomHeading } from './CustomHeadingExtenstion'
import WebPreview from '@components/Objects/Editor/Extensions/WebPreview/WebPreview'
import AICanvaToolkit from './AI/AICanvaToolkit'

interface Editor {
  content: string
  activity: any
}



function Canva(props: Editor) {
  /**
   * Important Note : This is a workaround to enable user interaction features to be implemented easily, like text selection, AI features and other planned features, this is set to true but otherwise it should be set to false.
   * Another workaround is implemented below to disable the editor from being edited by the user by setting the caret-color to transparent and using a custom extension to filter out transactions that add/edit/remove text.
   * To let the various Custom Extensions know that the editor is not editable, React context (EditorOptionsProvider) will be used instead of props.extension.options.editable.
   */
  const isEditable = true

  // Normalize content to fix AI-generated mark types (strong -> bold, em -> italic)
  const normalizedContent = useMemo(() => {
    if (!props.content) return props.content;
    try {
      const parsed = typeof props.content === 'string'
        ? JSON.parse(props.content)
        : props.content;
      return normalizeMarkTypes(parsed);
    } catch (e) {
      return props.content;
    }
  }, [props.content]);

  const editor: any = useEditor({
    immediatelyRender: false,
    editable: isEditable,
    extensions: [
      StarterKit.configure({
        heading: false,
        // Disable codeBlock since we use CodeBlockLowlight instead
        codeBlock: false,
        // Disable link since we use custom getLinkExtension() instead
        link: false,
        bulletList: {
          HTMLAttributes: {
            class: 'bullet-list',
          },
        },
        orderedList: {
          HTMLAttributes: {
            class: 'ordered-list',
          },
        },
      }),
      CustomHeading,
      NoTextInput,
      // Custom Extensions
      InfoCallout.configure({
        editable: isEditable,
      }),
      WarningCallout.configure({
        editable: isEditable,
      }),
      ImageBlock.configure({
        editable: isEditable,
        activity: props.activity,
      }),
      VideoBlock.configure({
        editable: true,
        activity: props.activity,
      }),
      AudioBlock.configure({
        editable: true,
        activity: props.activity,
      }),
      MathEquationBlock.configure({
        editable: false,
        activity: props.activity,
      }),
      PDFBlock.configure({
        editable: true,
        activity: props.activity,
      }),
      QuizBlock.configure({
        editable: isEditable,
        activity: props.activity,
      }),
      Youtube.configure({
        controls: true,
        modestBranding: true,
      }),
      CodeBlockLowlight.configure({
        lowlight,
      }),
      EmbedObjects.configure({
        editable: isEditable,
        activity: props.activity,
      }),
      Badges.configure({
        editable: isEditable,
        activity: props.activity,
      }),
      Buttons.configure({
        editable: isEditable,
        activity: props.activity,
      }),
      UserBlock.configure({
        editable: isEditable,
        activity: props.activity,
      }),
      Table.configure({
        resizable: true,
      }),
      getLinkExtension(),
      WebPreview.configure({
        editable: true,
        activity: props.activity,
      }),
      Flipcard.configure({
        editable: false,
        activity: props.activity,
      }),
      Scenarios.configure({
        editable: false,
        activity: props.activity,
      }),
      CodePlayground.configure({
        editable: false,
        activity: props.activity,
      }),
      MagicBlock.configure({
        editable: false,
        activity: props.activity,
      }),
      TableRow,
      TableHeader,
      TableCell,
    ],

    content: normalizedContent,
  })

  return (
    <EditorOptionsProvider options={{ isEditable: false }}>
      <div className="w-full mx-auto">
        <AICanvaToolkit activity={props.activity} editor={editor} />
        <div className="canva-content-wrapper">
          <TableOfContents editor={editor} />
          <EditorContent editor={editor} />
        </div>
      </div>
    </EditorOptionsProvider>
  )
}

export default Canva
