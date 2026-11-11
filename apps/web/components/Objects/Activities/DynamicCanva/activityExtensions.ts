import type { Extensions } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Youtube from '@tiptap/extension-youtube'
// Custom Extensions
import Callout from '@components/Objects/Editor/Extensions/Callout/Callout'
import { normalizeCalloutContent } from '@components/Objects/Editor/Extensions/Callout/calloutContent'
import InfoCallout from '@components/Objects/Editor/Extensions/Callout/Info/InfoCallout'
import WarningCallout from '@components/Objects/Editor/Extensions/Callout/Warning/WarningCallout'
import ImageBlock from '@components/Objects/Editor/Extensions/Image/ImageBlock'
import VideoBlock from '@components/Objects/Editor/Extensions/Video/VideoBlock'
import AudioBlock from '@components/Objects/Editor/Extensions/Audio/AudioBlock'
import MathEquationBlock from '@components/Objects/Editor/Extensions/MathEquation/MathEquationBlock'
import PDFBlock from '@components/Objects/Editor/Extensions/PDF/PDFBlock'
import H5PBlock from '@components/Objects/Editor/Extensions/H5P/H5PBlock'
import LibraryBlock from '@components/Objects/Editor/Extensions/Library/LibraryBlock'
import QuizBlock from '@components/Objects/Editor/Extensions/Quiz/QuizBlock'
import MagicBlock from '@components/Objects/Editor/Extensions/MagicBlocks/MagicBlock'
// Lowlight with a slim grammar set; see editorLowlight.ts
import { lowlight } from '@components/Objects/Editor/editorLowlight'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { NoTextInput } from '@components/Objects/Editor/Extensions/NoTextInput/NoTextInput'
import EmbedObjects from '@components/Objects/Editor/Extensions/EmbedObjects/EmbedObjects'
import Badges from '@components/Objects/Editor/Extensions/Badges/Badges'
import Buttons from '@components/Objects/Editor/Extensions/Buttons/Buttons'
import Flipcard from '@components/Objects/Editor/Extensions/Flipcard/Flipcard'
import FlipcardGrid from '@components/Objects/Editor/Extensions/Flipcard/FlipcardGrid'
import Scenarios from '@components/Objects/Editor/Extensions/Scenarios/Scenarios'
import CodePlayground from '@components/Objects/Editor/Extensions/CodePlayground/CodePlayground'
import { Table } from '@tiptap/extension-table'
import TableHeader from '@tiptap/extension-table-header'
import TableRow from '@tiptap/extension-table-row'
import TableCell from '@tiptap/extension-table-cell'
import UserBlock from '@components/Objects/Editor/Extensions/Users/UserBlock'
import { getLinkExtension } from '@components/Objects/Editor/EditorConf'
import { CustomHeading } from './CustomHeadingExtenstion'
import WebPreview from '@components/Objects/Editor/Extensions/WebPreview/WebPreview'
import ConditionalBlock from '@components/Objects/Editor/Extensions/Dynamic/ConditionalBlock'
import DynamicVariable from '@components/Objects/Editor/Extensions/Dynamic/DynamicVariable'
import { CommunityTag } from '@components/Objects/Communities/Tags/CommunityTag'

export interface ActivityExtensionOptions {
  activity: any
  // Passed by the activity/embed/board renderers so the video block can build
  // stream URLs even where the Org/Course React contexts aren't populated.
  courseUuid?: string
  orgUuid?: string
}

/**
 * The node schema of a learner-facing activity. Shared by the editor-backed
 * renderer (DynamicCanva) and the static one (StaticCanva / @learnhouse/react),
 * so both always understand exactly the same documents.
 */
export function getActivityExtensions(props: ActivityExtensionOptions): Extensions {
  // Blocks read editability from EditorOptionsProvider, not from these options.
  const isEditable = true
  return [
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
    Callout,
    // Legacy nodes: backward compat with existing calloutInfo/calloutWarning content
    InfoCallout.configure({ editable: isEditable }),
    WarningCallout.configure({ editable: isEditable }),
    ImageBlock.configure({
      editable: isEditable,
      activity: props.activity,
    }),
    VideoBlock.configure({
      editable: true,
      activity: props.activity,
      orgUuid: props.orgUuid,
      courseUuid: props.courseUuid,
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
    H5PBlock.configure({
      editable: isEditable,
      activity: props.activity,
    }),
    LibraryBlock.configure({
      editable: isEditable,
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
    FlipcardGrid.configure({
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
    // Learners get these already resolved by the API; course editors get
    // the raw document, so the nodes still need a schema here.
    ConditionalBlock,
    DynamicVariable,
    CommunityTag,
    TableRow,
    TableHeader,
    TableCell,
  ]
}

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

/**
 * Normalize stored content: fix AI-generated mark types (strong -> bold, em -> italic)
 * and wrap the inline text of callouts saved before they could hold lists.
 */
export function normalizeActivityContent(content: any): any {
  if (!content) return content
  try {
    const parsed = typeof content === 'string' ? JSON.parse(content) : content
    return normalizeCalloutContent(normalizeMarkTypes(parsed))
  } catch {
    return content
  }
}
