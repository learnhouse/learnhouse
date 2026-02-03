import { NodeViewProps, NodeViewWrapper } from '@tiptap/react'
import { Node } from '@tiptap/core'
import { X, Edit3, Expand, GripHorizontal, Lock } from 'lucide-react'
import React from 'react'
import { v4 as uuidv4 } from 'uuid'
import Image from 'next/image'
import lrnaiIcon from 'public/lrnai_icon.png'
import { useEditorProvider } from '@components/Contexts/Editor/EditorContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useCourse } from '@components/Contexts/CourseContext'
import { useOrg } from '@components/Contexts/OrgContext'
import { cn } from '@/lib/utils'
import MagicBlockModal from './MagicBlockModal'
import MagicBlockPreview from './MagicBlockPreview'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import type { MagicBlockContext, MagicBlockMessage } from './types'
import { getMagicBlockSession } from '@services/ai/magicblocks'
import { PlanLevel, planMeetsRequirement } from '@services/plans/plans'
import PlanBadge from '@components/Dashboard/Shared/PlanRestricted/PlanBadge'
import { useTranslation } from 'react-i18next'

interface EditorState {
  isEditable: boolean
}

interface Session {
  data?: {
    tokens?: {
      access_token?: string
    }
  }
}

interface Course {
  courseStructure: {
    course_uuid: string
    name: string
    description: string
  }
}

interface ExtendedNodeViewProps extends Omit<NodeViewProps, 'extension'> {
  extension: Node & {
    options: {
      activity: {
        activity_uuid: string
        name: string
        content?: any
      }
    }
  }
}

function MagicBlockComponent(props: ExtendedNodeViewProps) {
  const { t } = useTranslation()
  const { node, extension, updateAttributes } = props
  const editorState = useEditorProvider() as EditorState
  const session = useLHSession() as Session
  const course = useCourse() as Course | null
  const orgContext = useOrg() as any

  const [isModalOpen, setIsModalOpen] = React.useState(false)
  const [isPreviewModalOpen, setIsPreviewModalOpen] = React.useState(false)
  const [cachedMessages, setCachedMessages] = React.useState<MagicBlockMessage[]>([])
  const [isResizing, setIsResizing] = React.useState(false)

  const isEditable = editorState?.isEditable
  const accessToken = session?.data?.tokens?.access_token

  // Check plan for AI features
  const currentPlan: PlanLevel = orgContext?.config?.config?.cloud?.plan || 'free'
  const canUseAI = planMeetsRequirement(currentPlan, 'standard')

  // Get attributes from node
  const blockUuid = node.attrs.blockUuid || `magic_${uuidv4()}`
  const sessionUuid = node.attrs.sessionUuid
  const htmlContent = node.attrs.htmlContent
  const iterationCount = node.attrs.iterationCount || 0
  const title = node.attrs.title || 'Interactive Element'
  const height = node.attrs.height || 400

  // Predefined height options
  const PRESET_HEIGHTS = [
    { label: 'S', value: 300 },
    { label: 'M', value: 450 },
    { label: 'L', value: 600 },
    { label: 'XL', value: 800 },
    { label: 'XXL', value: 1200 },
  ]

  // Resize handlers
  const handleResizeStart = React.useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsResizing(true)

    const startY = e.clientY
    const startHeight = height

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaY = moveEvent.clientY - startY
      const newHeight = Math.max(200, Math.min(1500, startHeight + deltaY))
      updateAttributes({ height: newHeight })
    }

    const handleMouseUp = () => {
      setIsResizing(false)
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [height, updateAttributes])

  const handlePresetHeight = (presetHeight: number) => {
    updateAttributes({ height: presetHeight })
  }

  // Ensure block has a UUID
  React.useEffect(() => {
    if (!node.attrs.blockUuid) {
      updateAttributes({ blockUuid })
    }
  }, [node.attrs.blockUuid, blockUuid, updateAttributes])

  // Load session messages when opening modal with existing session
  React.useEffect(() => {
    if (isModalOpen && sessionUuid && accessToken && cachedMessages.length === 0) {
      getMagicBlockSession(sessionUuid, accessToken).then((result) => {
        if (result.success && result.data?.message_history) {
          setCachedMessages(result.data.message_history)
        }
      })
    }
  }, [isModalOpen, sessionUuid, accessToken, cachedMessages.length])

  // Build context from course and activity
  const buildContext = (): MagicBlockContext => {
    const activityContent = extension.options.activity.content
    let contentSummary = ''

    if (activityContent?.content) {
      // Extract text from editor content
      const extractText = (nodes: any[]): string => {
        return nodes
          .map((node) => {
            if (node.type === 'text') return node.text || ''
            if (node.type === 'paragraph' && node.content) {
              return extractText(node.content)
            }
            if (node.type === 'heading' && node.content) {
              return extractText(node.content)
            }
            if (node.content) return extractText(node.content)
            return ''
          })
          .join(' ')
          .slice(0, 500) // Limit to 500 chars
      }
      contentSummary = extractText(activityContent.content)
    }

    return {
      course_title: course?.courseStructure?.name || 'Course',
      course_description: course?.courseStructure?.description || '',
      activity_name: extension.options.activity.name || 'Activity',
      activity_content_summary: contentSummary,
    }
  }

  const handleSave = (
    newHtmlContent: string,
    newSessionUuid: string,
    newIterationCount: number
  ) => {
    updateAttributes({
      htmlContent: newHtmlContent,
      sessionUuid: newSessionUuid,
      iterationCount: newIterationCount,
    })
  }

  const handleRemove = () => {
    updateAttributes({
      htmlContent: null,
      sessionUuid: null,
      iterationCount: 0,
    })
    setCachedMessages([])
  }

  // Preview mode - show iframe only
  if (!isEditable && htmlContent) {
    return (
      <>
        <NodeViewWrapper className="block-magic w-full">
          <div className="relative group">
            <div className="rounded-xl overflow-hidden nice-shadow" style={{ height: `${height}px` }}>
              <MagicBlockPreview htmlContent={htmlContent} />
            </div>
            <button
              onClick={() => setIsPreviewModalOpen(true)}
              className="absolute top-2 right-2 p-2 bg-black/50 hover:bg-black/70 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
              title={t('editor.blocks.common.expand')}
            >
              <Expand className="w-4 h-4 text-white" />
            </button>
          </div>
        </NodeViewWrapper>

        <Modal
          isDialogOpen={isPreviewModalOpen}
          onOpenChange={setIsPreviewModalOpen}
          dialogTitle={t('editor.blocks.magic_block_content.interactive_element')}
          minWidth="xl"
          minHeight="lg"
          dialogContent={
            <div className="w-full h-[70vh]">
              <MagicBlockPreview htmlContent={htmlContent} />
            </div>
          }
        />
      </>
    )
  }

  // Preview mode - no content
  if (!isEditable && !htmlContent) {
    return null
  }

  // Edit mode
  return (
    <>
      <NodeViewWrapper className="block-magic w-full">
        <div
          style={{
            background: 'linear-gradient(0deg, rgba(0, 0, 0, 0.2) 0%, rgba(0, 0, 0, 0.2) 100%), radial-gradient(105.16% 105.16% at 50% -5.16%, rgba(255, 255, 255, 0.18) 0%, rgba(0, 0, 0, 0) 100%), rgb(2 1 25 / 98%)',
          }}
          className="rounded-2xl px-5 py-4 shadow-lg transition-all ease-linear ring-1 ring-inset ring-white/10 backdrop-blur-md"
        >
          {/* Header */}
          <div className="flex items-center justify-between pb-3">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <Image
                  className="outline outline-1 outline-neutral-200/20 rounded-lg"
                  width={20}
                  src={lrnaiIcon}
                  alt="Magic Block"
                />
                <span className="text-sm font-semibold text-white/70">
                  {t('editor.blocks.magic_block_content.title')}
                </span>
              </div>
              {sessionUuid && (
                <div className="bg-white/5 text-white/40 py-0.5 px-3 flex space-x-1 rounded-full items-center outline outline-1 outline-neutral-100/10">
                  <span className="text-xs font-semibold antialiased">
                    {t('editor.blocks.magic_block_content.iterations', { count: iterationCount, max: 6 })}
                  </span>
                </div>
              )}
            </div>
            {htmlContent && (
              <X
                size={20}
                className="text-white/50 hover:cursor-pointer bg-white/10 p-1 rounded-full items-center hover:bg-red-500/30 hover:text-red-300 transition-colors"
                onClick={handleRemove}
              />
            )}
          </div>

          {/* Content area */}
          {!htmlContent ? (
            // No content - show create button or plan restriction
            <div className="text-center py-8">
              {canUseAI ? (
                <div className="inline-flex flex-col items-center gap-3">
                  <div
                    style={{
                      background: 'conic-gradient(from 32deg at 53.75% 50%, rgb(35, 40, 93) 4deg, rgba(20, 0, 52, 0.95) 59deg, rgba(164, 45, 238, 0.88) 281deg)',
                    }}
                    className="p-4 rounded-full drop-shadow-md"
                  >
                    <Image src={lrnaiIcon} alt="Magic Block" width={32} height={32} />
                  </div>
                  <div className="space-y-1">
                    <p className="font-semibold text-white/80">
                      {t('editor.blocks.magic_block_content.create_interactive')}
                    </p>
                    <p className="text-sm text-white/50">
                      {t('editor.blocks.magic_block_content.generate_description')}
                    </p>
                  </div>
                  <button
                    onClick={() => setIsModalOpen(true)}
                    style={{
                      background: 'conic-gradient(from 32deg at 53.75% 50%, rgb(35, 40, 93) 4deg, rgba(20, 0, 52, 0.95) 59deg, rgba(164, 45, 238, 0.88) 281deg)',
                    }}
                    className="mt-2 px-5 py-2.5 text-white text-sm font-bold rounded-full transition-all duration-300 ease-in-out hover:scale-105 flex items-center gap-2 drop-shadow-md"
                  >
                    <Image
                      className="outline outline-1 outline-neutral-200/20 rounded-md"
                      width={16}
                      src={lrnaiIcon}
                      alt=""
                    />
                    {t('editor.blocks.magic_block_content.generate_with_ai')}
                  </button>
                </div>
              ) : (
                <div className="inline-flex flex-col items-center gap-3">
                  <div className="p-4 rounded-full bg-white/10">
                    <Lock className="w-8 h-8 text-white/40" />
                  </div>
                  <div className="space-y-1">
                    <p className="font-semibold text-white/80 flex items-center gap-2 justify-center">
                      {t('editor.blocks.magic_block_content.title')}
                      <PlanBadge currentPlan={currentPlan} requiredPlan="standard" size="sm" alwaysShow />
                    </p>
                    <p className="text-sm text-white/50">
                      {t('editor.blocks.magic_block_content.upgrade_required')}
                    </p>
                  </div>
                  <div className="mt-2 px-5 py-2.5 bg-white/10 text-white/50 text-sm font-bold rounded-full flex items-center gap-2 cursor-not-allowed">
                    <Image
                      className="outline outline-1 outline-neutral-200/20 rounded-md opacity-50 grayscale"
                      width={16}
                      src={lrnaiIcon}
                      alt=""
                    />
                    {t('editor.blocks.magic_block_content.generate_with_ai')}
                  </div>
                </div>
              )}
            </div>
          ) : (
            // Has content - show preview with edit button
            <div className="space-y-3">
              <div
                className="rounded-lg overflow-hidden ring-1 ring-inset ring-white/10 relative"
                style={{ height: `${height}px` }}
              >
                <MagicBlockPreview htmlContent={htmlContent} />
              </div>
              <div className="flex justify-between items-center">
                {/* Resize controls */}
                <div className="flex items-center gap-2">
                  {/* Preset heights */}
                  <div className="flex items-center gap-1">
                    {PRESET_HEIGHTS.map((preset) => (
                      <button
                        key={preset.label}
                        onClick={() => handlePresetHeight(preset.value)}
                        className={cn(
                          "px-2 py-0.5 text-xs font-medium rounded transition-colors",
                          height === preset.value
                            ? "bg-white/20 text-white/70"
                            : "bg-white/5 text-white/30 hover:bg-white/10 hover:text-white/50"
                        )}
                        title={`${preset.value}px`}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                  {/* Drag resize handle */}
                  <div
                    onMouseDown={handleResizeStart}
                    className={cn(
                      "flex items-center gap-1 px-2 py-0.5 cursor-ns-resize text-white/30 hover:text-white/50 transition-colors select-none rounded bg-white/5 hover:bg-white/10",
                      isResizing && "text-white/60 bg-white/15"
                    )}
                    title={t('editor.blocks.magic_block_content.drag_resize')}
                  >
                    <GripHorizontal className="w-3 h-3" />
                    <span className="text-xs font-medium">{height}px</span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setIsPreviewModalOpen(true)}
                    className="flex space-x-1.5 items-center bg-white/5 cursor-pointer px-4 py-1.5 rounded-xl outline outline-1 outline-neutral-100/10 text-xs font-semibold text-white/40 hover:text-white/60 hover:bg-white/10 hover:outline-neutral-200/40 delay-75 ease-linear transition-all"
                  >
                    <Expand className="w-4 h-4" />
                    <span>{t('editor.blocks.common.expand')}</span>
                  </button>
                  {iterationCount < 6 && (
                    <button
                      onClick={() => setIsModalOpen(true)}
                      className="flex space-x-1.5 items-center bg-white/5 cursor-pointer px-4 py-1.5 rounded-xl outline outline-1 outline-neutral-100/10 text-xs font-semibold text-white/40 hover:text-white/60 hover:bg-white/10 hover:outline-neutral-200/40 delay-75 ease-linear transition-all"
                    >
                      <Edit3 className="w-4 h-4" />
                      <span>{t('editor.blocks.magic_block_content.edit_left', { count: 6 - iterationCount })}</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </NodeViewWrapper>

      {/* Generation Modal */}
      {accessToken && (
        <MagicBlockModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          onSave={handleSave}
          blockUuid={blockUuid}
          activityUuid={extension.options.activity.activity_uuid}
          context={buildContext()}
          accessToken={accessToken}
          initialSessionUuid={sessionUuid}
          initialHtmlContent={htmlContent}
          initialIterationCount={iterationCount}
          initialMessages={cachedMessages}
        />
      )}

      {/* Preview Modal */}
      <Modal
        isDialogOpen={isPreviewModalOpen}
        onOpenChange={setIsPreviewModalOpen}
        dialogTitle={t('editor.blocks.magic_block_content.interactive_element')}
        minWidth="xl"
        minHeight="lg"
        dialogContent={
          <div className="w-full h-[70vh]">
            <MagicBlockPreview htmlContent={htmlContent} />
          </div>
        }
      />
    </>
  )
}

export default MagicBlockComponent
