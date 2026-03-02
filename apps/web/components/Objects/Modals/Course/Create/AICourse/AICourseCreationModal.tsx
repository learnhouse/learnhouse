'use client'
import React from 'react'
import { createPortal } from 'react-dom'
import { X, ArrowRight, Check, FlaskConical, Loader2 } from 'lucide-react'
import Image from 'next/image'
import { motion, AnimatePresence } from 'motion/react'
import { cn } from '@/lib/utils'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import lrnaiIcon from 'public/lrnai_icon.png'
import AICoursePreview from './AICoursePreview'
import AICourseChat from './AICourseChat'
import type { CoursePlan, CoursePlanningMessage, CreatedChapter, Attachment } from '@services/ai/courseplanning'
import {
  startCoursePlanningSession,
  iterateCoursePlanning,
  finalizeCoursePlan,
  parseCoursePlanFromStream,
  ENABLE_ACTIVITY_CONTENT_GENERATION,
} from '@services/ai/courseplanning'

interface AICourseCreationModalProps {
  isOpen: boolean
  onClose: () => void
  orgId: number
  orgslug: string
  accessToken: string
}

type WizardStep = 'planning' | 'content'

const MAX_PLANNING_ITERATIONS = 10

function AICourseCreationModal({
  isOpen,
  onClose,
  orgId,
  orgslug,
  accessToken,
}: AICourseCreationModalProps) {
  const { t, i18n } = useTranslation()
  const router = useRouter()

  const [step, setStep] = React.useState<WizardStep>('planning')
  const [sessionUuid, setSessionUuid] = React.useState<string | null>(null)
  const [messages, setMessages] = React.useState<CoursePlanningMessage[]>([])
  const [iterationCount, setIterationCount] = React.useState(0)
  const [isLoading, setIsLoading] = React.useState(false)
  const [streamingContent, setStreamingContent] = React.useState('')
  const [currentPlan, setCurrentPlan] = React.useState<CoursePlan | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  // Content step state
  const [createdChapters, setCreatedChapters] = React.useState<CreatedChapter[]>([])
  const [courseUuid, setCourseUuid] = React.useState<string | null>(null)
  const [isFinalizingPlan, setIsFinalizingPlan] = React.useState(false)
  const [hasVideoAttachment, setHasVideoAttachment] = React.useState(false)

  // Reset state when modal opens
  React.useEffect(() => {
    if (isOpen) {
      setStep('planning')
      setSessionUuid(null)
      setMessages([])
      setIterationCount(0)
      setStreamingContent('')
      setCurrentPlan(null)
      setError(null)
      setCreatedChapters([])
      setCourseUuid(null)
      setIsFinalizingPlan(false)
      setHasVideoAttachment(false)
    }
  }, [isOpen])

  const handleSendMessage = async (message: string, attachments?: Attachment[]) => {
    if (isLoading || iterationCount >= MAX_PLANNING_ITERATIONS) return

    setIsLoading(true)
    setError(null)
    setStreamingContent('')

    // Track if video attachment is being sent
    if (attachments?.some(a => a.type === 'youtube')) {
      setHasVideoAttachment(true)
    }

    // Build user message content with attachment info
    let displayMessage = message
    if (attachments && attachments.length > 0) {
      const attachmentNames = attachments.map(a => a.name).join(', ')
      displayMessage = `${message}\n\n[Attachments: ${attachmentNames}]`
    }

    // Add user message immediately
    const userMessage: CoursePlanningMessage = { role: 'user', content: displayMessage }
    setMessages((prev) => [...prev, userMessage])

    const onChunk = (chunk: string) => {
      setStreamingContent((prev) => prev + chunk)
    }

    const onComplete = (newSessionUuid: string) => {
      setSessionUuid(newSessionUuid)
      setIterationCount((prev) => prev + 1)

      // Extract plan from streaming content
      setTimeout(() => {
        setStreamingContent((current) => {
          const parsedPlan = parseCoursePlanFromStream(current)
          if (parsedPlan) {
            setCurrentPlan(parsedPlan)
          }

          // Add AI message
          const aiMessage: CoursePlanningMessage = { role: 'model', content: current }
          setMessages((prev) => [...prev, aiMessage])
          setStreamingContent('')
          setIsLoading(false)
          setHasVideoAttachment(false)
          return ''
        })
      }, 100)
    }

    const onError = (errorMsg: string) => {
      setError(errorMsg)
      setIsLoading(false)
      setStreamingContent('')
      setHasVideoAttachment(false)
    }

    try {
      if (!sessionUuid) {
        // Start new session with user's language
        await startCoursePlanningSession(
          orgId,
          message,
          accessToken,
          onChunk,
          onComplete,
          onError,
          i18n.language,
          attachments
        )
      } else {
        // Continue existing session
        await iterateCoursePlanning(
          sessionUuid,
          message,
          accessToken,
          onChunk,
          onComplete,
          onError,
          currentPlan,
          attachments
        )
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Unknown error')
    }
  }

  const handleUpdatePlan = (updatedPlan: CoursePlan) => {
    setCurrentPlan(updatedPlan)
  }

  const handleContinueToContent = async () => {
    if (!sessionUuid || !currentPlan) return

    setIsFinalizingPlan(true)
    setError(null)

    try {
      const result = await finalizeCoursePlan(sessionUuid, currentPlan, accessToken)

      if (result.success && result.data) {
        setCourseUuid(result.data.course_uuid)
        setCreatedChapters(result.data.chapters)

        if (ENABLE_ACTIVITY_CONTENT_GENERATION) {
          // Go to content generation step
          setStep('content')
          toast.success(t('courses.create.ai.course_structure_created'))
        } else {
          // Skip content generation, finish directly
          toast.success(t('courses.create.ai.course_created_success'))
          onClose()
          const courseId = result.data.course_uuid.replace('course_', '')
          router.push(`/dash/courses/course/${courseId}/content`)
        }
      } else {
        setError(result.error || 'Failed to create course structure')
        toast.error(result.error || t('courses.create.ai.failed_to_create'))
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error'
      setError(errorMsg)
      toast.error(errorMsg)
    } finally {
      setIsFinalizingPlan(false)
    }
  }

  const handleFinish = () => {
    if (!courseUuid) return

    onClose()
    // Remove 'course_' prefix for URL
    const courseId = courseUuid.replace('course_', '')
    router.push(`/dash/courses/course/${courseId}/content`)
  }

  // Use portal to render outside of DOM tree
  if (typeof document === 'undefined') return null

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 flex items-center justify-center" style={{ pointerEvents: 'none', zIndex: 'var(--z-toast)' }}>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={onClose}
            style={{ pointerEvents: 'auto' }}
          />

          {/* Modal */}
          <motion.div
            initial={{ y: 20, opacity: 0.3, filter: 'blur(5px)' }}
            animate={{ y: 0, opacity: 1, filter: 'blur(0px)' }}
            exit={{ y: 50, opacity: 0, filter: 'blur(25px)' }}
            transition={{
              type: 'spring',
              bounce: 0.35,
              duration: 1.7,
              mass: 0.2,
              velocity: 2,
            }}
            style={{
              pointerEvents: 'auto',
              background: 'linear-gradient(0deg, rgba(0, 0, 0, 0.2) 0%, rgba(0, 0, 0, 0.2) 100%), radial-gradient(105.16% 105.16% at 50% -5.16%, rgba(255, 255, 255, 0.18) 0%, rgba(0, 0, 0, 0) 100%), rgb(2 1 25 / 98%)',
            }}
            className="relative w-[95vw] max-w-[1400px] h-[85vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden ring-1 ring-inset ring-white/10 backdrop-blur-md min-h-0"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 flex-shrink-0">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <Image
                    className="outline outline-1 outline-neutral-200/20 rounded-lg"
                    width={24}
                    src={lrnaiIcon}
                    alt="AI Course"
                  />
                  <span className="text-sm font-semibold text-white/70">
                    {t('courses.create.ai.title')}
                  </span>
                </div>
                <div className="bg-white/5 text-white/40 py-0.5 px-3 flex space-x-1 rounded-full items-center">
                  <FlaskConical size={14} />
                  <span className="text-xs font-semibold antialiased">
                    {t('common.experimental')}
                  </span>
                </div>
                {/* Step indicator */}
                <div className="flex items-center gap-2 ml-4">
                  <div className={cn(
                    "flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold transition-colors",
                    step === 'planning'
                      ? "bg-purple-500/20 text-purple-300"
                      : "bg-green-500/20 text-green-300"
                  )}>
                    {step === 'planning' ? (
                      <>
                        {ENABLE_ACTIVITY_CONTENT_GENERATION && (
                          <span className="w-5 h-5 flex items-center justify-center bg-purple-500/30 rounded-full">1</span>
                        )}
                        {t('courses.create.ai.step_planning')}
                      </>
                    ) : (
                      <>
                        <Check size={14} />
                        {t('courses.create.ai.step_planning')}
                      </>
                    )}
                  </div>
                  {ENABLE_ACTIVITY_CONTENT_GENERATION && (
                    <>
                      <ArrowRight size={14} className="text-white/30" />
                      <div className={cn(
                        "flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold transition-colors",
                        step === 'content'
                          ? "bg-purple-500/20 text-purple-300"
                          : "bg-white/5 text-white/30"
                      )}>
                        <span className="w-5 h-5 flex items-center justify-center bg-white/10 rounded-full">2</span>
                        {t('courses.create.ai.step_content')}
                      </div>
                    </>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-3">
                {step === 'planning' && currentPlan && (
                  <button
                    onClick={handleContinueToContent}
                    disabled={isFinalizingPlan || isLoading}
                    className={cn(
                      "flex items-center gap-2 px-4 py-1.5 rounded-xl text-xs font-semibold transition-all delay-75 ease-linear",
                      ENABLE_ACTIVITY_CONTENT_GENERATION
                        ? "bg-purple-500/20 text-purple-300 hover:bg-purple-500/30 outline outline-1 outline-purple-500/30"
                        : "bg-green-500/20 text-green-300 hover:bg-green-500/30 outline outline-1 outline-green-500/30",
                      (isFinalizingPlan || isLoading) && "opacity-50 cursor-not-allowed"
                    )}
                  >
                    {isFinalizingPlan ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        {t('courses.create.ai.creating_structure')}
                      </>
                    ) : ENABLE_ACTIVITY_CONTENT_GENERATION ? (
                      <>
                        <ArrowRight className="w-4 h-4" />
                        {t('courses.create.ai.continue_to_content')}
                      </>
                    ) : (
                      <>
                        <Check className="w-4 h-4" />
                        {t('courses.create.ai.create_course')}
                      </>
                    )}
                  </button>
                )}
                {step === 'content' && (
                  <button
                    onClick={handleFinish}
                    className="flex items-center gap-2 px-4 py-1.5 rounded-xl text-xs font-semibold bg-green-500/20 text-green-300 hover:bg-green-500/30 outline outline-1 outline-green-500/30 transition-all"
                  >
                    <Check className="w-4 h-4" />
                    {t('courses.create.ai.finish_and_edit')}
                  </button>
                )}
                <X
                  size={20}
                  className="text-white/50 hover:cursor-pointer bg-white/10 p-1 rounded-full items-center hover:bg-white/20 transition-colors"
                  onClick={onClose}
                />
              </div>
            </div>

            {/* Error banner */}
            {error && (
              <div className="px-6 py-3 bg-red-500/20 outline outline-1 outline-red-500 text-red-200 text-sm flex-shrink-0">
                {error}
              </div>
            )}

            {/* Content - Two panel layout */}
            <div className="flex-1 flex min-h-0">
              {/* Left panel - Preview */}
              <div className="flex-1 border-r border-white/5 relative overflow-hidden">
                <AICoursePreview
                  step={step}
                  plan={currentPlan}
                  createdChapters={createdChapters}
                  courseUuid={courseUuid}
                  sessionUuid={sessionUuid}
                  accessToken={accessToken}
                  onUpdatePlan={handleUpdatePlan}
                  isLoading={isLoading}
                  streamingContent={streamingContent}
                />
              </div>

              {/* Right panel - Chat */}
              <div className="w-[400px] flex flex-col min-h-0">
                <AICourseChat
                  messages={messages}
                  iterationCount={iterationCount}
                  maxIterations={MAX_PLANNING_ITERATIONS}
                  isLoading={isLoading}
                  onSendMessage={handleSendMessage}
                  step={step}
                  hasVideoAttachment={hasVideoAttachment}
                />
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  )
}

export default AICourseCreationModal
