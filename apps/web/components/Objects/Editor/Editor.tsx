'use client'
import React from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { ToolbarButtons } from './Toolbar/ToolbarButtons'
import { motion } from 'motion/react'
import Image from 'next/image'
import { DividerVerticalIcon, SlashIcon } from '@radix-ui/react-icons'
import learnhouseAI_icon from 'public/learnhouse_ai_simple.png'
import {
  AIEditorStateTypes,
  useAIEditor,
  useAIEditorDispatch,
} from '@components/Contexts/AI/AIEditorContext'
import { useTranslation } from 'react-i18next'

// Extensions
import InfoCallout from './Extensions/Callout/Info/InfoCallout'
import WarningCallout from './Extensions/Callout/Warning/WarningCallout'
import ImageBlock from './Extensions/Image/ImageBlock'
import Youtube from '@tiptap/extension-youtube'
import VideoBlock from './Extensions/Video/VideoBlock'
import AudioBlock from './Extensions/Audio/AudioBlock'
import { Eye, Monitor, History, AlertTriangle, RefreshCw, GitMerge, Loader2 } from 'lucide-react'
import MathEquationBlock from './Extensions/MathEquation/MathEquationBlock'
import PDFBlock from './Extensions/PDF/PDFBlock'
import QuizBlock from './Extensions/Quiz/QuizBlock'
import { Table } from '@tiptap/extension-table'
import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'
import TableRow from '@tiptap/extension-table-row'
import ToolTip from '@components/Objects/StyledElements/Tooltip/Tooltip'
import Link from 'next/link'
import { getCourseThumbnailMediaDirectory } from '@services/media/media'
import { getLinkExtension } from './EditorConf'
import WebPreview from './Extensions/WebPreview/WebPreview'

// Lowlight — `common` already includes css, javascript, typescript, xml, python, java
import { common, createLowlight } from 'lowlight'
const lowlight = createLowlight(common)
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { CourseProvider } from '@components/Contexts/CourseContext'
import AIEditorToolkit from './AI/AIEditorToolkit'
import AIEditorSidePanel from './AI/AIEditorSidePanel'
import AIStreamingMark from './Extensions/AIStreaming/AIStreamingMark'
import AISelectionHighlight from './Extensions/AISelectionHighlight/AISelectionHighlight'
import useGetAIFeatures from '@components/Hooks/useGetAIFeatures'
import { getUriWithOrg } from '@services/config/config'
import EmbedObjects from './Extensions/EmbedObjects/EmbedObjects'
import Badges from './Extensions/Badges/Badges'
import Buttons from './Extensions/Buttons/Buttons'
import Flipcard from './Extensions/Flipcard/Flipcard'
import Scenarios from './Extensions/Scenarios/Scenarios'
import CodePlayground from './Extensions/CodePlayground/CodePlayground'
import { useMediaQuery } from 'usehooks-ts'
import UserAvatar from '../UserAvatar'
import UserBlock from './Extensions/Users/UserBlock'
import DragHandle from './Extensions/DragHandle/DragHandle'
import { SlashCommands } from './Extensions/SlashCommands'
import PasteFileHandler from './Extensions/PasteFileHandler/PasteFileHandler'
import MagicBlock from './Extensions/MagicBlocks/MagicBlock'
import PlanBadge from '@components/Dashboard/Shared/PlanRestricted/PlanBadge'
import { PlanLevel } from '@services/plans/plans'
import { useOrg } from '@components/Contexts/OrgContext'
import VersionHistoryPanel from './VersionHistory/VersionHistoryPanel'
import MergeConflictModal from './VersionHistory/MergeConflictModal'
import { usePlan } from '@components/Hooks/usePlan'

interface ConflictInfo {
  hasConflict: boolean
  remoteVersion: number
  localVersion: number
  lastModifiedBy: string | null
  lastModifiedAt: string | null
}

interface Editor {
  content: string
  activity: any
  course: any
  org: any
  session: any
  setContent: (content: any, forceOverwrite?: boolean) => Promise<any>
  checkForConflicts: () => Promise<ConflictInfo | null>
  fetchRemoteContent: () => Promise<any>
  localVersion: number
  onReady?: () => void
}

function Editor(props: Editor) {
  const { t } = useTranslation()
  const dispatchAIEditor = useAIEditorDispatch() as any
  const aiEditorState = useAIEditor() as AIEditorStateTypes
  const is_ai_feature_enabled = useGetAIFeatures({ feature: 'editor' })
  const [editorReady, setEditorReady] = React.useState(false)

  // Conflict detection state
  const [conflictInfo, setConflictInfo] = React.useState<ConflictInfo | null>(null)
  const [isCheckingConflict, setIsCheckingConflict] = React.useState(false)
  const [showConflictModal, setShowConflictModal] = React.useState(false)
  const [showVersionHistory, setShowVersionHistory] = React.useState(false)

  // Merge modal state
  const [showMergeModal, setShowMergeModal] = React.useState(false)
  const [remoteContent, setRemoteContent] = React.useState<any>(null)
  const [isLoadingRemote, setIsLoadingRemote] = React.useState(false)

  // Get feature flags from resolved_features (API is source of truth)
  const orgContext = useOrg() as any
  const currentPlan = usePlan()
  const rf = orgContext?.config?.config?.resolved_features
  const canUseAI = rf?.ai?.enabled === true
  const canUseVersioning = rf?.versioning?.enabled === true
  const isButtonAvailable = is_ai_feature_enabled

  // remove course_ from course_uuid
  const course_uuid = props.course.course_uuid.substring(7)

  // remove activity_ from activity_uuid
  const activity_uuid = props.activity.activity_uuid.substring(9)

  const editor: any = useEditor({
    editable: true,
    extensions: [
      StarterKit.configure({
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
      InfoCallout.configure({
        editable: true,
      }),
      WarningCallout.configure({
        editable: true,
      }),
      ImageBlock.configure({
        editable: true,
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
        editable: true,
        activity: props.activity,
      }),
      PDFBlock.configure({
        editable: true,
        activity: props.activity,
      }),
      QuizBlock.configure({
        editable: true,
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
        editable: true,
        activity: props.activity,
      }),
      Badges.configure({
        editable: true,
        activity: props.activity,
      }),
      Buttons.configure({
        editable: true,
        activity: props.activity,
      }),
      UserBlock.configure({
        editable: true,
        activity: props.activity,
      }),
      Table.configure({
        resizable: true,
      }),
      TableRow,
      TableHeader,
      TableCell,
      getLinkExtension(),
      WebPreview.configure({
        editable: true,
        activity: props.activity,
      }),
      Flipcard.configure({
        editable: true,
        activity: props.activity,
      }),
      Scenarios.configure({
        editable: true,
        activity: props.activity,
      }),
      CodePlayground.configure({
        editable: true,
        activity: props.activity,
      }),
      DragHandle,
      SlashCommands.configure({
        currentPlan: currentPlan,
      }),
      PasteFileHandler.configure({
        activity: props.activity,
        getAccessToken: () => props.session?.data?.tokens?.access_token,
      }),
      MagicBlock.configure({
        editable: true,
        activity: props.activity,
      }),
      AIStreamingMark,
      AISelectionHighlight,
    ],
    content: props.content,
    immediatelyRender: false,
    onCreate: () => { setEditorReady(true); props.onReady?.(); },
  })

  // Handler to check for conflicts on save button hover
  const handleSaveButtonHover = React.useCallback(async () => {
    if (isCheckingConflict) return
    setIsCheckingConflict(true)
    try {
      const info = await props.checkForConflicts()
      setConflictInfo(info)
      if (info?.hasConflict) {
        setShowConflictModal(true)
      }
    } finally {
      setIsCheckingConflict(false)
    }
  }, [props.checkForConflicts, isCheckingConflict])

  // Handler for save with conflict awareness
  const handleSave = React.useCallback(async (forceOverwrite: boolean = false) => {
    if (!editor) return

    // If there's a known conflict and not force overwrite, show modal
    if (conflictInfo?.hasConflict && !forceOverwrite) {
      setShowConflictModal(true)
      return
    }

    const result = await props.setContent(editor.getJSON(), forceOverwrite)

    // If save was successful, clear conflict info
    if (!result?.hasConflict) {
      setConflictInfo(null)
      setShowConflictModal(false)
    }
  }, [editor, conflictInfo, props.setContent])

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
    editor.commands.setContent(mergedContent)

    // Save the merged content (force overwrite since we've manually merged)
    const result = await props.setContent(mergedContent, true)

    if (!result?.hasConflict) {
      setConflictInfo(null)
      setShowMergeModal(false)
    }
  }, [editor, props.setContent])

  const isMobile = useMediaQuery('(max-width: 767px)')
  if (isMobile) {
    // TODO: Work on a better editor mobile experience
    return (
      <div className="h-screen w-full bg-[#f8f8f8] flex items-center justify-center p-4">
        <div className="bg-white p-6 rounded-lg shadow-md text-center">
          <h2 className="text-xl font-bold mb-4">{t('editor.desktop_only')}</h2>
          <Monitor className='mx-auto my-5' size={60} />
          <p>{t('editor.desktop_only_message')}</p>
          <p>{t('editor.switch_to_desktop')}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="activity-editor-page">
      {/* Version History Panel */}
      {canUseVersioning && (
        <VersionHistoryPanel
          isOpen={showVersionHistory}
          onClose={() => setShowVersionHistory(false)}
          activityUuid={props.activity.activity_uuid}
          currentVersion={props.localVersion}
          activity={props.activity}
          courseUuid={props.course.course_uuid}
        />
      )}

      {/* Merge Conflict Modal */}
      {editor && (
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

      <CourseProvider courseuuid={props.course.course_uuid}>
          <div className="activity-editor-top">
            <div className="activity-editor-doc-section">
              <div className="activity-editor-info-wrapper">
                <Link href="/">
                  <EditorLearnHouseLogo />
                </Link>
                <Link target="_blank" href={`/course/${course_uuid}`}>
                  <img
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
            <div className="activity-editor-users-section space-x-2">
              <div>
                <div className="transition-all ease-linear text-teal-100 rounded-md hover:cursor-pointer">
                  {isButtonAvailable && canUseAI && (
                    <div
                      onClick={() =>
                        dispatchAIEditor({
                          type: aiEditorState.isSidePanelOpen
                            ? 'setSidePanelClose'
                            : 'setSidePanelOpen',
                        })
                      }
                      style={{
                        background:
                          'conic-gradient(from 32deg at 53.75% 50%, rgb(35, 40, 93) 4deg, rgba(20, 0, 52, 0.95) 59deg, rgba(164, 45, 238, 0.88) 281deg)',
                      }}
                      className="rounded-md px-3 py-2 drop-shadow-md flex  items-center space-x-1.5 text-sm text-white hover:cursor-pointer transition delay-150 duration-300 ease-in-out hover:scale-105"
                    >
                      {' '}
                      <i>
                        <Image
                          className=""
                          width={20}
                          src={learnhouseAI_icon}
                          alt=""
                        />
                      </i>{' '}
                      <i className="not-italic text-xs font-bold">{t('editor.ai_editor')}</i>
                    </div>
                  )}
                  {isButtonAvailable && !canUseAI && (
                    <div
                      className="rounded-md px-3 py-2 drop-shadow-md flex items-center space-x-1.5 text-sm text-gray-400 bg-gray-200 cursor-not-allowed opacity-70"
                    >
                      <i>
                        <Image
                          className="opacity-50 grayscale"
                          width={20}
                          src={learnhouseAI_icon}
                          alt=""
                        />
                      </i>
                      <i className="not-italic text-xs font-bold">{t('editor.ai_editor')}</i>
                      <PlanBadge currentPlan={currentPlan} requiredPlan={(rf?.ai?.required_plan || 'standard') as PlanLevel} size="sm" />
                    </div>
                  )}
                </div>
              </div>
              <DividerVerticalIcon
                style={{
                  marginTop: 'auto',
                  marginBottom: 'auto',
                  color: 'grey',
                  opacity: '0.5',
                }}
              />
              <div className="activity-editor-left-options space-x-2 ">
                {/* Version History Button */}
                {canUseVersioning ? (
                  <ToolTip content={t('editor.versioning.version_history')}>
                    <div
                      className="flex bg-neutral-100 hover:bg-neutral-200 transition-all ease-linear h-9 px-3 py-2 font-black justify-center items-center text-sm shadow-sm text-neutral-600 rounded-lg hover:cursor-pointer"
                      onClick={() => setShowVersionHistory(true)}
                    >
                      <History size={15} />
                    </div>
                  </ToolTip>
                ) : (
                  <ToolTip content={t('editor.versioning.version_history')}>
                    <div className="flex bg-gray-100 h-9 px-3 py-2 font-black justify-center items-center text-sm shadow-sm text-gray-400 rounded-lg cursor-not-allowed opacity-70 gap-1.5">
                      <History size={15} className="opacity-50" />
                      <PlanBadge currentPlan={currentPlan} requiredPlan={(rf?.versioning?.required_plan || 'pro') as PlanLevel} size="sm" />
                    </div>
                  </ToolTip>
                )}

                {/* Save Button with Conflict Detection */}
                <div className="relative">
                  <div
                    className={`${
                      conflictInfo?.hasConflict
                        ? 'bg-amber-500 hover:bg-amber-600'
                        : 'bg-sky-600 hover:bg-sky-700'
                    } transition-all ease-linear px-3 py-2 font-black text-sm shadow-sm text-white rounded-lg hover:cursor-pointer flex items-center gap-1.5`}
                    onClick={() => handleSave(false)}
                    onMouseEnter={handleSaveButtonHover}
                  >
                    {isCheckingConflict && (
                      <RefreshCw size={14} className="animate-spin" />
                    )}
                    {conflictInfo?.hasConflict && !isCheckingConflict && (
                      <AlertTriangle size={14} />
                    )}
                    {t('editor.save')}
                  </div>

                  {/* Conflict Modal */}
                  {showConflictModal && conflictInfo?.hasConflict && (
                    <div className="absolute top-full end-0 mt-2 w-72 bg-white rounded-lg shadow-xl border border-gray-200 p-4 z-50">
                      <div className="flex items-start gap-2 mb-3">
                        <AlertTriangle className="text-amber-500 flex-shrink-0 mt-0.5" size={18} />
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
                            <Loader2 size={12} className="animate-spin" />
                          ) : (
                            <Eye size={12} />
                          )}
                          {t('editor.versioning.conflict.show_changes')}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                <ToolTip content={t('editor.preview')}>
                  <Link
                    target="_blank"
                    href={`/course/${course_uuid}/activity/${activity_uuid}`}
                  >
                    <div className="flex bg-neutral-600 hover:bg-neutral-700 transition-all ease-linear h-9 px-3 py-2 font-black justify-center items-center text-sm shadow-sm text-neutral-100 rounded-lg hover:cursor-pointer">
                      <Eye className="mx-auto items-center" size={15} />
                    </div>
                  </Link>
                </ToolTip>
              </div>
              <DividerVerticalIcon
                style={{
                  marginTop: 'auto',
                  marginBottom: 'auto',
                  color: 'grey',
                  opacity: '0.5',
                }}
              />

              <div className="activity-editor-user-profile">
                <UserAvatar border="border-4" use_with_session={true} width={45} />
              </div>
            </div>
          </div>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{
            type: 'spring',
            stiffness: 360,
            damping: 70,
            delay: 0.5,
          }}
          exit={{ opacity: 0 }}
          className="flex gap-5"
          style={{ position: 'relative', margin: '0 40px' }}
        >
          <div className="activity-editor-content-wrapper" style={{ flex: 1, margin: 0, marginTop: '97px' }}>
            <AIEditorToolkit activity={props.activity} editor={editor} />
            <EditorContent editor={editor} />
          </div>

          {/* AI Editor Side Panel */}
          {editorReady && canUseAI && (
            <AIEditorSidePanel
              editor={editor}
              activity={props.activity}
              course={props.course}
            />
          )}
        </motion.div>
      </CourseProvider>
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
