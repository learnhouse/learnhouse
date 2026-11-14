'use client'
import React from 'react'
import { useBlockTheme } from '@components/Objects/Activities/BlockTheme/BlockThemeScope'
import dynamic from 'next/dynamic'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
// ToolbarButtons pulls in @phosphor-icons/react (~360KB) and only renders
// after the editor is interactive; defer it so it doesn't block first paint.
const ToolbarButtons = dynamic(
  () => import('./Toolbar/ToolbarButtons').then((m) => m.ToolbarButtons),
  { ssr: false, loading: () => null }
)
import { motion } from 'motion/react'
import Image from 'next/image'
import { SlashIcon } from '@radix-ui/react-icons'
import { AIButton, AIMark } from '@components/Objects/AI/AIBrand'
import {
  AIEditorStateTypes,
  useAIEditor,
  useAIEditorDispatch,
} from '@components/Contexts/AI/AIEditorContext'
import { useTranslation } from 'react-i18next'
import { useLHAnalytics, AnalyticsEvent } from '@services/analytics'

// Extensions
import InfoCallout from './Extensions/Callout/Info/InfoCallout'
import WarningCallout from './Extensions/Callout/Warning/WarningCallout'
import Callout from './Extensions/Callout/Callout'
import { normalizeCalloutContent } from './Extensions/Callout/calloutContent'
import ImageBlock from './Extensions/Image/ImageBlock'
import Youtube from '@tiptap/extension-youtube'
import VideoBlock from './Extensions/Video/VideoBlock'
import AudioBlock from './Extensions/Audio/AudioBlock'
import { Eye, Warning, CircleNotch } from '@phosphor-icons/react'
import MathEquationBlock from './Extensions/MathEquation/MathEquationBlock'
import PDFBlock from './Extensions/PDF/PDFBlock'
import H5PBlock from './Extensions/H5P/H5PBlock'
import LibraryBlock from './Extensions/Library/LibraryBlock'
import QuizBlock from './Extensions/Quiz/QuizBlock'
import { Table } from '@tiptap/extension-table'
import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'
import TableRow from '@tiptap/extension-table-row'
import Link from 'next/link'
import { getCourseThumbnailMediaDirectory } from '@services/media/media'
import { getLinkExtension } from './EditorConf'
import WebPreview from './Extensions/WebPreview/WebPreview'

// Lowlight with a slim grammar set; see editorLowlight.ts
import { lowlight } from './editorLowlight'
import { LHCodeBlock as CodeBlockLowlight, ToggleBlock, DividerStyle, TableControls, TEXT_MARKS } from './Blocks/extensions'
import { CourseProvider } from '@components/Contexts/CourseContext'
const AIEditorToolkit = dynamic(() => import('./AI/AIEditorToolkit'), { ssr: false, loading: () => null })
const AIEditorSidePanel = dynamic(() => import('./AI/AIEditorSidePanel'), { ssr: false, loading: () => null })
const ActivityComments = dynamic(() => import('./Comments/ActivityComments'), { ssr: false, loading: () => null })
const SelectionBubble = dynamic(() => import('./Blocks/bubble/SelectionBubble'), { ssr: false, loading: () => null })
import AIStreamingMark from './Extensions/AIStreaming/AIStreamingMark'
import AISelectionHighlight from './Extensions/AISelectionHighlight/AISelectionHighlight'
import CommentMark from './Comments/CommentMark'
import useGetAIFeatures from '@components/Hooks/useGetAIFeatures'
import { getAPIUrl, getUriWithOrg } from '@services/config/config'
import EmbedObjects from './Extensions/EmbedObjects/EmbedObjects'
import Badges from './Extensions/Badges/Badges'
import Buttons from './Extensions/Buttons/Buttons'
import Flipcard from './Extensions/Flipcard/Flipcard'
import FlipcardGrid from './Extensions/Flipcard/FlipcardGrid'
import Scenarios from './Extensions/Scenarios/Scenarios'
import CodePlayground from './Extensions/CodePlayground/CodePlayground'
import UserAvatar from '../UserAvatar'
import UserBlock from './Extensions/Users/UserBlock'
import DragHandle from './Extensions/DragHandle/DragHandle'
import { SlashCommands } from './Extensions/SlashCommands'
import PasteFileHandler from './Extensions/PasteFileHandler/PasteFileHandler'
import MagicBlock from './Extensions/MagicBlocks/MagicBlock'
import ConditionalBlock from './Extensions/Dynamic/ConditionalBlock'
import DynamicVariable from './Extensions/Dynamic/DynamicVariable'
import VariableSuggestion from './Extensions/Dynamic/VariableSuggestion'
import { CommunityTag, CommunityTagSuggestion } from '@components/Objects/Communities/Tags/CommunityTag'
import { DynamicActivityContext, DynamicReachProvider } from './Extensions/Dynamic/DynamicReach'
import { EDITOR_EVENTS } from './Templates/templateContent'
import PlanBadge from '@components/Dashboard/Shared/PlanRestricted/PlanBadge'
import { PlanLevel } from '@services/plans/plans'
import { useOrg } from '@components/Contexts/OrgContext'
import './editorShell.css'
import type { CollabSession } from './Collab/collabRuntime'
import { CollabContext } from './Collab/CollabContext'
import { hasUnsyncedEdits } from './Collab/collabStatus'
const CollabHeaderControls = dynamic(() => import('./Collab/CollabHeaderControls'), { ssr: false, loading: () => null })
import EditorHeaderControls from './Header/EditorHeaderControls'
import { useEditorLocale } from './Translation/EditorLocaleContext'
import { isRtlLocale } from '@services/courses/translations'
const TranslationSourcePane = dynamic(() => import('./Translation/TranslationPanes').then((m) => m.TranslationSourcePane), { ssr: false, loading: () => null })
const TranslationBar = dynamic(() => import('./Translation/TranslationPanes').then((m) => m.TranslationBar), { ssr: false, loading: () => null })
const EditorLanguageSwitcher = dynamic(() => import('./Translation/EditorLanguageSwitcher'), { ssr: false, loading: () => null })
import { useAutosave, type SaveOutcome } from './Autosave/useAutosave'
import { autosaveIndicatorStatus } from './Autosave/autosaveTiming'
const VersionHistoryPanel = dynamic(() => import('./VersionHistory/VersionHistoryPanel'), { ssr: false, loading: () => null })
const MergeConflictModal = dynamic(() => import('./VersionHistory/MergeConflictModal'), { ssr: false, loading: () => null })
const ActivitySwitcher = dynamic(() => import('./ActivitySwitcher'), { ssr: false, loading: () => null })
const ViewAsPreview = dynamic(() => import('./Extensions/Dynamic/ViewAsPreview'), { ssr: false, loading: () => null })
const TemplatesModal = dynamic(() => import('./Templates/TemplatesModal'), { ssr: false, loading: () => null })
import { usePlan } from '@components/Hooks/usePlan'
import {
  createBeforeUnloadHandler,
  getEditorContentSnapshot,
  hasEditorContentChanged,
  shouldGuardNavigationClick,
} from './unsavedChangesGuard'
import ThumbnailImage from '@components/Objects/Thumbnails/ThumbnailImage'
import { isWhiteLabelPlan } from '@components/Hooks/useLearnHouseBranding'
import OrgSquareLogo, { OrgInitial } from '@components/Objects/Org/OrgSquareLogo'

interface ConflictInfo {
  hasConflict: boolean
  remoteVersion: number
  localVersion: number
  lastModifiedBy: string | null
  lastModifiedAt: string | null
}

interface EditorProps {
  content: any
  activity: any
  course: any
  org: any
  session: any
  setContent: (_content: any, _forceOverwrite?: boolean, _options?: { quiet?: boolean }) => Promise<any>
  checkForConflicts: () => Promise<ConflictInfo | null>
  fetchRemoteContent: () => Promise<any>
  localVersion: number
  onReady?: () => void
  /** Collaborative mode (see Collab/useActivityCollab); null = autosave mode. */
  collab?: CollabSession | null
  /** Shown but not editable yet (the first moments while live editing connects). */
  readOnly?: boolean
  /** Live editing is still connecting (the save status says so). */
  connecting?: boolean
  /** Lets the wrapper know when autosave mode can hand over to live editing. */
  onLegacyHandle?: (_handle: LegacyEditorHandle | null) => void
  /** Caret to restore once live editing took over from autosave mode. */
  handoverSelection?: { from: number; to: number; focused: boolean } | null
  /** 'manual' when live editing is turned off (org or activity): Save button, unsaved guard. */
  saveMode?: 'auto' | 'manual'
  /** The activity's live editing override, shown in the History menu. */
  liveEditing?: LiveEditingControl
}

export interface LiveEditingControl {
  mode: 'default' | 'on' | 'off'
  orgDefault: boolean
  onChange: (_mode: 'default' | 'on' | 'off') => Promise<boolean>
}

export interface LegacyEditorHandle {
  /** No unsaved edit and no save in flight. */
  isClean: () => boolean
  /** Whether a ProseMirror JSON document equals what the editor shows. */
  matches: (_json: unknown) => boolean
  lastSavedAt: () => number | null
  /** Where the caret is, to put it back after switching to live editing. */
  selection: () => { from: number; to: number; focused: boolean }
  /** The document as ProseMirror JSON. */
  getJSON: () => unknown
  /** Manual mode: edits not saved yet. */
  hasUnsavedChanges: () => boolean
}

function Editor(props: EditorProps) {
  // Block theme for the editing surface (dark mode); see the content div below.
  const contentThemeRef = React.useRef<HTMLDivElement>(null)
  const contentTheme = useBlockTheme(contentThemeRef, 'auto')
  const { t } = useTranslation()
  const { track } = useLHAnalytics('editor')
  const dispatchAIEditor = useAIEditorDispatch() as any
  const aiEditorState = useAIEditor() as AIEditorStateTypes
  const is_ai_feature_enabled = useGetAIFeatures({ feature: 'editor' })
  const [editorReady, setEditorReady] = React.useState(false)
  const [hasUnsavedChanges, setHasUnsavedChanges] = React.useState(false)
  const hasUnsavedChangesRef = React.useRef(false)
  React.useEffect(() => {
    hasUnsavedChangesRef.current = hasUnsavedChanges
  }, [hasUnsavedChanges])
  const manualSave = props.saveMode === 'manual' && !props.collab
  // Autosave (defined once the editor exists) for callbacks declared before it
  const autosaveRef = React.useRef<ReturnType<typeof useAutosave> | null>(null)
  const savedContentSnapshotRef = React.useRef(getEditorContentSnapshot(props.content))

  // Conflict detection state
  const [conflictInfo, setConflictInfo] = React.useState<ConflictInfo | null>(null)
  const [showConflictModal, setShowConflictModal] = React.useState(false)
  const [showVersionHistory, setShowVersionHistory] = React.useState(false)

  // Merge modal state
  const [showMergeModal, setShowMergeModal] = React.useState(false)
  const [remoteContent, setRemoteContent] = React.useState<any>(null)
  const [isLoadingRemote, setIsLoadingRemote] = React.useState(false)

  // Dynamic content dialogs
  const [showViewAs, setShowViewAs] = React.useState(false)
  const [templatesMode, setTemplatesMode] = React.useState<'insert' | 'save' | null>(null)

  // The slash menu can't reach this component, so it opens these by event.
  React.useEffect(() => {
    const openTemplates = () => setTemplatesMode('insert')
    const saveTemplate = () => setTemplatesMode('save')
    const viewAs = () => setShowViewAs(true)
    window.addEventListener(EDITOR_EVENTS.openTemplates, openTemplates)
    window.addEventListener(EDITOR_EVENTS.saveTemplate, saveTemplate)
    window.addEventListener(EDITOR_EVENTS.viewAs, viewAs)
    return () => {
      window.removeEventListener(EDITOR_EVENTS.openTemplates, openTemplates)
      window.removeEventListener(EDITOR_EVENTS.saveTemplate, saveTemplate)
      window.removeEventListener(EDITOR_EVENTS.viewAs, viewAs)
    }
  }, [])

  // Get feature flags from resolved_features (API is source of truth)
  const orgContext = useOrg() as any
  // Editing a translation (`?lang=`): source pane, no version history
  const editorLocale = useEditorLocale()
  const currentPlan = usePlan()
  const rf = orgContext?.config?.config?.resolved_features
  const canUseAI = rf?.ai?.enabled === true
  const canUseVersioning = rf?.versioning?.enabled === true
  const isButtonAvailable = is_ai_feature_enabled

  // remove course_ from course_uuid
  const course_uuid = props.course.course_uuid.substring(7)

  // remove activity_ from activity_uuid
  const activity_uuid = props.activity.activity_uuid.substring(9)

  // Stable closures for extension config so the extensions array can be
  // memoized even if `props.session` / `props.activity` references change
  // between renders (e.g., after a save updates EditorWrapper state).
  const sessionRef = React.useRef(props.session)
  sessionRef.current = props.session
  const activityRef = React.useRef(props.activity)
  activityRef.current = props.activity
  const getAccessToken = React.useCallback(
    () => sessionRef.current?.data?.tokens?.access_token,
    []
  )
  // Capture the activity object at first render so extensions get a stable
  // reference; extensions only read static fields like activity_uuid that
  // don't change during a session. Keyed off activity_uuid below so a new
  // activity (different uuid) does rebuild correctly.
  const stableActivity = React.useMemo(
    () => activityRef.current,
    [props.activity.activity_uuid]
  )

  const extensions = React.useMemo(
    () => [
      StarterKit.configure({
        codeBlock: false,
        link: false,
        bulletList: { HTMLAttributes: { class: 'bullet-list' } },
        orderedList: { HTMLAttributes: { class: 'ordered-list' } },
        // Collaboration brings its own undo, scoped to this user's changes
        ...(props.collab ? { undoRedo: false as const } : {}),
      }),
      Callout,
      InfoCallout.configure({ editable: true }),
      WarningCallout.configure({ editable: true }),
      ImageBlock.configure({ editable: true, activity: stableActivity }),
      VideoBlock.configure({ editable: true, activity: stableActivity, orgUuid: props.org?.org_uuid, courseUuid: props.course?.course_uuid }),
      AudioBlock.configure({ editable: true, activity: stableActivity }),
      MathEquationBlock.configure({ editable: true, activity: stableActivity }),
      PDFBlock.configure({ editable: true, activity: stableActivity }),
      H5PBlock.configure({ editable: true, activity: stableActivity }),
      LibraryBlock.configure({ editable: true, activity: stableActivity }),
      QuizBlock.configure({ editable: true, activity: stableActivity }),
      Youtube.configure({ controls: true, modestBranding: true }),
      CodeBlockLowlight.configure({ lowlight }),
      EmbedObjects.configure({ editable: true, activity: stableActivity }),
      Badges.configure({ editable: true, activity: stableActivity }),
      Buttons.configure({ editable: true, activity: stableActivity }),
      UserBlock.configure({ editable: true, activity: stableActivity }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      getLinkExtension(),
      WebPreview.configure({ editable: true, activity: stableActivity }),
      Flipcard.configure({ editable: true, activity: stableActivity }),
      FlipcardGrid.configure({ editable: true, activity: stableActivity }),
      Scenarios.configure({ editable: true, activity: stableActivity }),
      CodePlayground.configure({ editable: true, activity: stableActivity }),
      DragHandle,
      ToggleBlock, DividerStyle, TableControls, ...TEXT_MARKS,
      SlashCommands.configure({ currentPlan }),
      PasteFileHandler.configure({
        activity: stableActivity,
        getAccessToken,
      }),
      MagicBlock.configure({ editable: true, activity: stableActivity }),
      ConditionalBlock,
      DynamicVariable,
      VariableSuggestion,
      CommunityTag,
      CommunityTagSuggestion,
      AIStreamingMark,
      AISelectionHighlight,
      CommentMark,
      ...(props.collab?.extensions ?? []),
    ],
    [stableActivity, currentPlan, getAccessToken, props.collab]
  )

  React.useEffect(() => {
    savedContentSnapshotRef.current = getEditorContentSnapshot(normalizeCalloutContent(props.content))
    setHasUnsavedChanges(false)
  }, [props.activity.activity_uuid, props.content])

  const markEditorContentSaved = React.useCallback((content: unknown) => {
    savedContentSnapshotRef.current = getEditorContentSnapshot(content)
    setHasUnsavedChanges(false)
  }, [])

  // Wrap the inline text of callouts saved before they could hold lists
  const editorContent = React.useMemo(
    () => normalizeCalloutContent(props.content),
    [props.content]
  )

  const editor: any = useEditor({
    editable: !props.readOnly && !props.collab?.getSnapshot().readOnly,
    extensions,
    // In collaborative mode the content comes from the room
    content: props.collab ? undefined : editorContent,
    immediatelyRender: false,
    onCreate: ({ editor }) => {
      // Re-baseline against the editor's own normalized doc. The initial
      // snapshot is taken from props.content (the stored ProseMirror doc),
      // but onUpdate compares editor.getJSON(), and TipTap may normalize the
      // doc on load, so aligning the baseline here avoids a false "unsaved"
      // state before any real edit.
      savedContentSnapshotRef.current = getEditorContentSnapshot(editor.getJSON())
      setHasUnsavedChanges(false)
      track(AnalyticsEvent.ActivityEditorOpened, { ai_enabled: canUseAI })
      setTimeout(() => {
        setEditorReady(true)
        props.onReady?.()
      }, 0)
    },
    onUpdate: ({ editor }) => {
      // Only manual saving needs the unsaved diff (a full getJSON per change)
      if (props.collab || props.saveMode !== 'manual') return
      setHasUnsavedChanges(
        hasEditorContentChanged(savedContentSnapshotRef.current, editor.getJSON())
      )
    },
  })


  // Handler for save with conflict awareness
  const handleSave = React.useCallback(async (forceOverwrite: boolean = false) => {
    if (!editor) return

    // If there's a known conflict and not force overwrite, show modal
    if (conflictInfo?.hasConflict && !forceOverwrite) {
      setShowConflictModal(true)
      return
    }

    const currentContent = editor.getJSON()
    const result = await props.setContent(currentContent, forceOverwrite)

    // If save was successful, clear conflict info
    if (!result?.hasConflict) {
      setConflictInfo(null)
      setShowConflictModal(false)
    }
    if (result?.result && !result.hasConflict) {
      markEditorContentSaved(currentContent)
      autosaveRef.current?.markSaved()
    }
  }, [editor, conflictInfo, props.setContent, markEditorContentSaved])

  // Autosave mode (no live editing): saves itself, keeps the version check,
  // and opens the conflict prompt instead of overwriting someone's work.
  const autosaveSave = React.useCallback(async (): Promise<SaveOutcome> => {
    if (!editor) return 'failed'
    const content = editor.getJSON()
    const result = await props.setContent(content, false, { quiet: true })
    if (result?.hasConflict) {
      setConflictInfo(result.conflictInfo ?? null)
      setShowConflictModal(true)
      return 'conflict'
    }
    if (result?.result) {
      markEditorContentSaved(content)
      return 'saved'
    }
    return 'failed'
  }, [editor, props.setContent, markEditorContentSaved])
  const autosave = useAutosave({ editor, enabled: !props.collab && !props.readOnly && !manualSave, save: autosaveSave })
  React.useEffect(() => {
    autosaveRef.current = autosave
  })

  React.useEffect(() => {
    // emitUpdate=false: not an edit, so autosave must not see it as one
    if (editor && !editor.isDestroyed) editor.setEditable(!props.readOnly && !props.collab?.getSnapshot().readOnly, false)
  }, [editor, props.readOnly, props.collab])

  const { onLegacyHandle } = props
  React.useEffect(() => {
    if (!onLegacyHandle || props.collab || !editor) return
    onLegacyHandle({
      isClean: () => autosaveRef.current?.isClean() ?? true,
      lastSavedAt: () => autosaveRef.current?.lastSavedAt ?? null,
      selection: () => ({ from: editor.state.selection.from, to: editor.state.selection.to, focused: editor.isFocused }),
      getJSON: () => editor.getJSON(),
      hasUnsavedChanges: () => hasUnsavedChangesRef.current,
      matches: (json: unknown) => {
        try {
          return editor.schema.nodeFromJSON(json).eq(editor.state.doc)
        } catch {
          return false
        }
      },
    })
    return () => onLegacyHandle(null)
  }, [onLegacyHandle, props.collab, editor])

  // Back where the caret was before live editing took over
  const { handoverSelection } = props
  React.useEffect(() => {
    if (!editor || !props.collab || !handoverSelection) return
    const id = setTimeout(() => {
      if (editor.isDestroyed) return
      const size = editor.state.doc.content.size
      const from = Math.min(handoverSelection.from, size)
      const to = Math.min(handoverSelection.to, size)
      try {
        editor.commands.setTextSelection({ from, to })
        if (handoverSelection.focused) editor.commands.focus()
      } catch {
        // the content moved under it; leave the caret where it is
      }
    }, 60)
    return () => clearTimeout(id)
  }, [editor, props.collab, handoverSelection])

  // Naming a version in autosave mode: save first, then name it
  const nameVersionLegacy = React.useCallback(async (label: string) => {
    autosaveRef.current?.flush()
    for (let i = 0; i < 50 && !(autosaveRef.current?.isClean() ?? true); i++) {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    if (!(autosaveRef.current?.isClean() ?? true)) return false
    try {
      const res = await fetch(`${getAPIUrl()}activities/${props.activity.activity_uuid}/versions/named`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${getAccessToken()}`, 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ label }),
      })
      return res.ok
    } catch {
      return false
    }
  }, [props.activity.activity_uuid, getAccessToken])

  // Leaving while a save failed or is in conflict: confirm (otherwise the
  // autosave already saved, or saves on the way out)
  const mustConfirmLeave = manualSave
    ? hasUnsavedChanges
    : !props.collab && (autosave.status === 'failed' || autosave.status === 'conflict' || autosave.status === 'offline')
  React.useEffect(() => {
    if (!manualSave || !hasUnsavedChanges) return
    const handler = createBeforeUnloadHandler(() => true)
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [manualSave, hasUnsavedChanges])
  React.useEffect(() => {
    if (!mustConfirmLeave) return
    const handleNavigationClick = (event: MouseEvent) => {
      const anchor = (event.target as HTMLElement | null)?.closest?.('a') as HTMLAnchorElement | null
      const shouldGuard = shouldGuardNavigationClick(
        {
          defaultPrevented: event.defaultPrevented,
          button: event.button,
          metaKey: event.metaKey,
          ctrlKey: event.ctrlKey,
          shiftKey: event.shiftKey,
          altKey: event.altKey,
        },
        anchor ? { href: anchor.href, target: anchor.target, origin: anchor.origin, hasDownload: anchor.hasAttribute('download') } : null,
        window.location.origin
      )
      if (shouldGuard && !window.confirm(t('editor.unsaved_changes_warning', 'You have unsaved changes. Leave without saving?'))) {
        event.preventDefault()
        event.stopPropagation()
      }
    }
    document.addEventListener('click', handleNavigationClick, true)
    return () => document.removeEventListener('click', handleNavigationClick, true)
  }, [mustConfirmLeave, t])

  // Cmd+S / Ctrl+S → save. The save handler shows its own toast.
  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 's') {
        e.preventDefault()
        // Manual mode saves; autosave mode saves right away; live mode has nothing to do
        if (props.collab) return
        if (props.saveMode === 'manual') handleSave(false)
        else autosaveRef.current?.flush()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [props.collab, props.saveMode, handleSave])

  // Collaborative mode: only edits not yet on the server (offline, in
  // flight) are at risk when leaving; checked at unload, no re-render.
  React.useEffect(() => {
    const collab = props.collab
    if (!collab) return
    const handler = createBeforeUnloadHandler(() => hasUnsyncedEdits(collab.getSnapshot()))
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [props.collab])

  // Handler to reload with remote changes
  const handleReloadRemote = React.useCallback(() => {
    // Reload the page to get the latest version
    window.location.reload()
  }, [])

  // Handler to open merge modal
  const handleOpenMerge = React.useCallback(async () => {
    if (!editor) return

    setIsLoadingRemote(true)
    try {
      const remote = await props.fetchRemoteContent()
      if (remote) {
        setRemoteContent(remote)
        setShowMergeModal(true)
        setShowConflictModal(false)
      }
    } catch (error) {
      console.error('Error fetching remote content:', error)
    } finally {
      setIsLoadingRemote(false)
    }
  }, [editor, props.fetchRemoteContent])

  // Handler for merge complete
  const handleMergeComplete = React.useCallback(async (mergedContent: any) => {
    if (!editor) return

    // Update editor with merged content
    editor.commands.setContent(normalizeCalloutContent(mergedContent))

    // Save the merged content (force overwrite since we've manually merged)
    const result = await props.setContent(mergedContent, true)

    if (!result?.hasConflict) {
      setConflictInfo(null)
      setShowMergeModal(false)
    }
    if (result?.result && !result.hasConflict) {
      // Snapshot the editor's normalized doc (matches onUpdate's comparison
      // basis) rather than the raw merged object, so the editor isn't flagged
      // dirty again immediately after a successful merge-save.
      markEditorContentSaved(editor.getJSON())
      autosaveRef.current?.markSaved()
    }
  }, [editor, props.setContent, markEditorContentSaved])

  const versioningControls = {
    enabled: canUseVersioning,
    badge: canUseVersioning ? undefined : (
      <PlanBadge currentPlan={currentPlan} requiredPlan={(rf?.versioning?.required_plan || 'pro') as PlanLevel} size="sm" />
    ),
  }

  return (
    <div className="activity-editor-page">
      {/* Version History Panel: only mount when first opened so the chunk
          + the versions list fetch don't run on every editor load. */}
      {canUseVersioning && showVersionHistory && !editorLocale && (
        <VersionHistoryPanel
          isOpen={showVersionHistory}
          onClose={() => setShowVersionHistory(false)}
          activityUuid={props.activity.activity_uuid}
          currentVersion={props.localVersion}
          activity={props.activity}
          courseUuid={props.course.course_uuid}
        />
      )}

      {/* Merge Conflict Modal, same idea: only mount when actually needed. */}
      {editor && showMergeModal && (
        <MergeConflictModal
          isOpen={showMergeModal}
          onClose={() => setShowMergeModal(false)}
          localContent={editor.getJSON()}
          remoteContent={remoteContent}
          localVersion={props.localVersion}
          remoteVersion={conflictInfo?.remoteVersion || props.localVersion}
          remoteAuthor={conflictInfo?.lastModifiedBy || null}
          onMergeComplete={handleMergeComplete}
          activity={props.activity}
          courseUuid={props.course.course_uuid}
        />
      )}

      <CollabContext.Provider value={props.collab ?? null}>
      <CourseProvider courseuuid={props.course.course_uuid} initialCourseStructure={props.course}>
      <DynamicActivityContext.Provider value={props.activity.activity_uuid}>
          {editor && showViewAs && (
            <ViewAsPreview
              activity={props.activity}
              getContent={() => editor.getJSON()}
              onClose={() => setShowViewAs(false)}
            />
          )}
          {editor && templatesMode && (
            <TemplatesModal
              mode={templatesMode}
              editor={editor}
              activity={props.activity}
              onClose={() => setTemplatesMode(null)}
            />
          )}
          <div className="activity-editor-top">
            <ActivitySwitcher
              course={props.course}
              activity={props.activity}
              isDirty={mustConfirmLeave}
              onSave={() => (manualSave ? handleSave(false) : autosaveRef.current?.flush())}
            />
            <div className="activity-editor-doc-section">
              <div className="activity-editor-info-wrapper">
                <Link href="/">
                  {isWhiteLabelPlan(currentPlan) ? (
                    <div className="rounded-md w-[25px] h-[25px] overflow-hidden bg-white ring-1 ring-black/10">
                      <OrgSquareLogo org={orgContext} wideInsetClassName="p-0.5" fallback={<OrgInitial org={orgContext} className="text-[11px]" />} />
                    </div>
                  ) : (
                    <EditorLearnHouseLogo />
                  )}
                </Link>
                <Link target="_blank" href={`/course/${course_uuid}`}>
                  <ThumbnailImage
                    className="activity-editor-info-thumbnail"
                    src={`${props.course.thumbnail_image ? getCourseThumbnailMediaDirectory(
                      props.org?.org_uuid,
                      props.course.course_uuid,
                      props.course.thumbnail_image
                    ) : getUriWithOrg(props.org?.slug, '/empty_thumbnail.png')}`}
                    alt={props.course.name}
                  />
                </Link>
                <div className="activity-editor-doc-name">
                  {' '}
                  <b>{props.course.name}</b> <SlashIcon /> {props.activity.name}{' '}
                </div>
              </div>
              <div className="activity-editor-buttons-wrapper">
                <ToolbarButtons editor={editor} />
              </div>
            </div>
            <div className="activity-editor-users-section gap-1.5">
              {/* Writing helpers */}
              <div className="flex items-center gap-2">
                <div>
                  <div className="transition-all ease-linear text-teal-100 rounded-md hover:cursor-pointer">
                    {isButtonAvailable && canUseAI && (
                      <AIButton
                        size="md"
                        aria-pressed={aiEditorState.isSidePanelOpen}
                        onClick={() => {
                          if (!aiEditorState.isSidePanelOpen) {
                            track(AnalyticsEvent.AiEditorPanelOpened)
                            track(AnalyticsEvent.AiAssistantOpened, { surface: 'editor' })
                          }
                          dispatchAIEditor({
                            type: aiEditorState.isSidePanelOpen
                              ? 'setSidePanelClose'
                              : 'setSidePanelOpen',
                          })
                        }}
                      >
                        {t('editor.ai_editor')}
                      </AIButton>
                    )}
                    {isButtonAvailable && !canUseAI && (
                      <div
                        className="h-9 ps-2 pe-3 rounded-lg flex items-center gap-2 text-sm font-semibold text-neutral-400 bg-neutral-100 ring-1 ring-inset ring-neutral-200 cursor-not-allowed"
                      >
                        <AIMark size={20} alt="" className="opacity-50 grayscale" />
                        <span>{t('editor.ai_editor')}</span>
                        <PlanBadge currentPlan={currentPlan} requiredPlan={(rf?.ai?.required_plan || 'standard') as PlanLevel} size="sm" />
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div className="activity-editor-left-options gap-2">
                <EditorLanguageSwitcher courseUuid={props.course.course_uuid} />
                {/* Page controls: presence, save status, preview, history. Saving
                    is always automatic (live editing or autosave). */}
                {props.collab ? (
                  <CollabHeaderControls
                    session={props.collab}
                    activityUuid={props.activity.activity_uuid}
                    previewHref={`/course/${course_uuid}/activity/${activity_uuid}`}
                    onViewAs={() => setShowViewAs(true)}
                    versioning={versioningControls}
                    onOpenHistory={() => setShowVersionHistory(true)}
                    liveEditing={editorLocale ? undefined : props.liveEditing}
                    hideHistory={!!editorLocale}
                  />
                ) : (
                  <EditorHeaderControls
                    activityUuid={props.activity.activity_uuid}
                    liveEditing={editorLocale ? undefined : props.liveEditing}
                    hideHistory={!!editorLocale}
                    manualSave={manualSave ? { dirty: hasUnsavedChanges, onSave: () => handleSave(false), conflict: !!conflictInfo?.hasConflict } : undefined}
                    save={manualSave ? {
                      status: hasUnsavedChanges ? 'unsaved' : 'saved',
                      lastSavedAt: null,
                    } : {
                      status: autosaveIndicatorStatus(autosave.status, {
                        connecting: !!props.connecting,
                        readOnly: !!props.readOnly,
                        dirty: autosave.dirty,
                        savedOnce: autosave.lastSavedAt !== null,
                      }),
                      lastSavedAt: autosave.lastSavedAt,
                      onRetry: autosave.status === 'conflict' ? () => setShowConflictModal(true) : autosave.flush,
                    }}
                    previewHref={`/course/${course_uuid}/activity/${activity_uuid}`}
                    onViewAs={() => setShowViewAs(true)}
                    canName={!props.readOnly}
                    versioning={versioningControls}
                    onNameVersion={nameVersionLegacy}
                    onOpenHistory={() => setShowVersionHistory(true)}
                    conflict={
                      showConflictModal && conflictInfo?.hasConflict && (
                    <div className="absolute top-full end-0 mt-2 w-72 bg-white rounded-lg shadow-xl border border-gray-200 p-4 z-50">
                      <div className="flex items-start gap-2 mb-3">
                        <Warning className="text-amber-500 flex-shrink-0 mt-0.5" size={18} />
                        <div>
                          <h4 className="font-semibold text-gray-900 text-sm">{t('editor.versioning.conflict.title')}</h4>
                          <p className="text-xs text-gray-600 mt-1">
                            {t('editor.versioning.conflict.editing_notice', { author: conflictInfo.lastModifiedBy || t('editor.versioning.conflict.another_teacher') })}
                          </p>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <button
                          className="w-full px-3 py-2.5 text-sm font-medium text-white bg-sky-600 hover:bg-sky-700 rounded-lg transition-colors"
                          onClick={() => handleSave(true)}
                        >
                          {t('editor.versioning.conflict.overwrite_mine')}
                        </button>
                        <button
                          className="w-full px-3 py-2.5 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg border border-gray-200 transition-colors"
                          onClick={handleReloadRemote}
                        >
                          {t('editor.versioning.conflict.discard_mine')}
                        </button>
                        <button
                          className="w-full px-3 py-2 text-xs font-medium text-sky-600 hover:text-sky-700 hover:underline transition-colors flex items-center justify-center gap-1"
                          onClick={handleOpenMerge}
                          disabled={isLoadingRemote}
                        >
                          {isLoadingRemote ? (
                            <CircleNotch size={12} className="animate-spin" />
                          ) : (
                            <Eye size={12} />
                          )}
                          {t('editor.versioning.conflict.show_changes')}
                        </button>
                      </div>
                    </div>
                  )
                    }
                  />
                )}
              </div>
              <div className="activity-editor-user-profile">
                <UserAvatar border="border-2" rounded="rounded-lg" use_with_session={true} width={28} />
              </div>
            </div>
          </div>
        <motion.div
          // Content shows at once: no entrance fade (switching to live editing
          // also remounts the editor on the same content)
          initial={false}
          animate={{ opacity: 1 }}
          transition={{
            type: 'spring',
            stiffness: 360,
            damping: 70,
            delay: 0.5,
          }}
          exit={{ opacity: 0 }}
          // Phone layout (sticky top bar, edge-to-edge page) lives in
          // styles/mobile-dashboard.css under .activity-editor-body.
          className={`activity-editor-body flex gap-5${editorLocale ? ' lh-translation-mode' : ''}`}
          style={{ position: 'relative', margin: '0 40px' }}
        >
          {editorLocale && <TranslationSourcePane activity={props.activity} />}
          <div className="activity-editor-content-wrapper" style={{ flex: 1, margin: 0, marginTop: '97px' }}>
            {editorLocale && <TranslationBar activity={props.activity} course={props.course} />}
            <AIEditorToolkit activity={props.activity} editor={editor} />
            <DynamicReachProvider editor={editor} activityUuid={props.activity.activity_uuid}>
              {/* Blocks follow the page behind them like in the lesson view
                  (BlockThemeScope): in dark mode the content gets the block
                  theme's dark variant. In light the hook finds a light host
                  and adds nothing, so the markup is unchanged. */}
              <div
                ref={contentThemeRef}
                dir={editorLocale && isRtlLocale(editorLocale.locale) ? 'rtl' : undefined}
                lang={editorLocale?.locale}
                className={contentTheme.tone ? 'lh-bt' : undefined}
                data-lh-bt={contentTheme.tone ? contentTheme.mode : undefined}
                data-lh-bt-tone={contentTheme.tone ?? undefined}
                data-lh-bt-ink={contentTheme.tone ? contentTheme.ink : undefined}
                data-lh-bt-size={contentTheme.tone ? contentTheme.size : undefined}
                style={contentTheme.tone ? (contentTheme.vars as React.CSSProperties) : undefined}
              >
                <EditorContent editor={editor} />
              </div>
              {editorReady && editor && <SelectionBubble editor={editor} activity={props.activity} course={props.course} />}
            </DynamicReachProvider>
          </div>

          {editorReady && <ActivityComments editor={editor} activity={props.activity} />}

          {/* AI Editor Side Panel */}
          {editorReady && canUseAI && (
            <AIEditorSidePanel
              editor={editor}
              activity={props.activity}
              course={props.course}
              nameVersion={props.collab || editorLocale ? undefined : nameVersionLegacy}
              onOpenHistory={canUseVersioning && !editorLocale ? () => setShowVersionHistory(true) : undefined}
            />
          )}
        </motion.div>
      </DynamicActivityContext.Provider>
      </CourseProvider>
      </CollabContext.Provider>
    </div>
  )
}

const logoAnimations = [
  // Slide up from bottom
  {
    initial: { y: 20 },
    animate: { y: 0 },
    transition: { delay: 1, type: "spring" as const, stiffness: 120, damping: 20 },
  },
  // Fade in with scale
  {
    initial: { opacity: 0, scale: 0.5 },
    animate: { opacity: 1, scale: 1 },
    transition: { delay: 1, type: "spring" as const, stiffness: 150, damping: 18 },
  },
  // Slide down from top
  {
    initial: { y: -20 },
    animate: { y: 0 },
    transition: { delay: 1, type: "spring" as const, stiffness: 120, damping: 20 },
  },
]

const EditorLearnHouseLogo = () => {
  const [animation] = React.useState(
    () => logoAnimations[Math.floor(Math.random() * logoAnimations.length)]
  )

  return (
    <div className="bg-black rounded-md w-[25px] h-[25px] flex items-center justify-center overflow-hidden">
      <motion.div
        initial={animation.initial}
        animate={animation.animate}
        transition={animation.transition}
      >
        <Image
          src="/lrn.svg"
          alt="LearnHouse"
          width={14}
          height={14}
          className="invert"
        />
      </motion.div>
    </div>
  )
}

export default Editor
