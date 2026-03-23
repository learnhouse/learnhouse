'use client'
import React from 'react'
import { Loader2, BookOpen, FileText, Sparkles, Check, ChevronDown, ChevronRight, Play, RotateCcw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import toast from 'react-hot-toast'
import Image from 'next/image'
import lrnaiIcon from 'public/lrnai_icon.png'
import type { CreatedChapter } from '@services/ai/courseplanning'
import {
  generateActivityContent,
  parseActivityContentFromStream,
} from '@services/ai/courseplanning'
import { updateActivity } from '@services/courses/activities'

interface ContentGenerationPanelProps {
  chapters: CreatedChapter[]
  courseUuid: string | null
  sessionUuid: string | null
  accessToken: string
  courseName: string
  courseDescription: string
}

interface ActivityGenerationState {
  isGenerating: boolean
  isGenerated: boolean
  streamContent: string
  content: any | null
  error: string | null
}

function ContentGenerationPanel({
  chapters,
  courseUuid,
  sessionUuid,
  accessToken,
  courseName,
  courseDescription,
}: ContentGenerationPanelProps) {
  const { t } = useTranslation()
  // Expand all chapters by default
  const [expandedChapters, setExpandedChapters] = React.useState<Set<number>>(new Set())
  const [activityStates, setActivityStates] = React.useState<Record<string, ActivityGenerationState>>({})
  const [selectedActivity, setSelectedActivity] = React.useState<string | null>(null)

  // Expand all chapters when they load
  React.useEffect(() => {
    if (chapters.length > 0) {
      setExpandedChapters(new Set(chapters.map((_, i) => i)))
    }
  }, [chapters])

  const toggleChapter = (index: number) => {
    const newExpanded = new Set(expandedChapters)
    if (newExpanded.has(index)) {
      newExpanded.delete(index)
    } else {
      newExpanded.add(index)
    }
    setExpandedChapters(newExpanded)
  }

  const handleGenerateContent = async (
    activityUuid: string,
    activityName: string,
    activityDescription: string,
    chapterName: string
  ) => {
    if (!sessionUuid) return

    // Update state to show generating
    setActivityStates((prev) => ({
      ...prev,
      [activityUuid]: {
        isGenerating: true,
        isGenerated: false,
        streamContent: '',
        content: null,
        error: null,
      },
    }))

    setSelectedActivity(activityUuid)

    let fullContent = ''

    const onChunk = (chunk: string) => {
      fullContent += chunk
      setActivityStates((prev) => ({
        ...prev,
        [activityUuid]: {
          ...prev[activityUuid],
          streamContent: fullContent,
        },
      }))
    }

    const onComplete = async (_sessionUuid: string) => {
      // Parse the content from the stream
      console.log('[AI Content] Full content received, length:', fullContent.length)
      console.log('[AI Content] Full content preview:', fullContent.substring(0, 500))
      const parsedContent = parseActivityContentFromStream(fullContent)
      console.log('[AI Content] Parsed content:', parsedContent ? 'success' : 'failed')
      if (parsedContent) {
        console.log('[AI Content] Parsed content type:', parsedContent.type)
        console.log('[AI Content] Parsed content has content array:', Array.isArray(parsedContent.content))
        console.log('[AI Content] Parsed content length:', parsedContent.content?.length || 0)
      }

      if (parsedContent) {
        // Save content using the standard updateActivity function (same as editor)
        try {
          console.log('[AI Content] Saving to database for activity:', activityUuid)
          console.log('[AI Content] Content to save:', JSON.stringify(parsedContent).substring(0, 300))

          // Use the standard activity update endpoint (same as editor uses)
          const result = await updateActivity(
            { content: parsedContent },
            activityUuid,
            accessToken
          )
          console.log('[AI Content] Save result:', result)

          if (result.success) {
            setActivityStates((prev) => ({
              ...prev,
              [activityUuid]: {
                isGenerating: false,
                isGenerated: true,
                streamContent: '',
                content: parsedContent,
                error: null,
              },
            }))
            toast.success(t('courses.create.ai.content_generated_success'))
          } else {
            const errorMsg = result.data?.detail || 'Failed to save content'
            throw new Error(errorMsg)
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Failed to save content'
          console.error('[AI Content] Save error:', errorMsg)
          setActivityStates((prev) => ({
            ...prev,
            [activityUuid]: {
              isGenerating: false,
              isGenerated: false,
              streamContent: '',
              content: null,
              error: errorMsg,
            },
          }))
          toast.error(errorMsg)
        }
      } else {
        console.error('[AI Content] Failed to parse content')
        setActivityStates((prev) => ({
          ...prev,
          [activityUuid]: {
            isGenerating: false,
            isGenerated: false,
            streamContent: '',
            content: null,
            error: 'Failed to parse generated content',
          },
        }))
        toast.error(t('courses.create.ai.content_parse_error'))
      }
    }

    const onError = (error: string) => {
      setActivityStates((prev) => ({
        ...prev,
        [activityUuid]: {
          isGenerating: false,
          isGenerated: false,
          streamContent: '',
          content: null,
          error,
        },
      }))
      toast.error(error)
    }

    try {
      await generateActivityContent(
        sessionUuid,
        activityUuid,
        activityName,
        activityDescription,
        chapterName,
        courseName,
        courseDescription,
        accessToken,
        onChunk,
        onComplete,
        onError
      )
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Unknown error')
    }
  }

  const handleGenerateAllContent = async () => {
    for (const chapter of chapters) {
      for (const activity of chapter.activities) {
        const state = activityStates[activity.activity_uuid]
        if (!state?.isGenerated && !state?.isGenerating) {
          await handleGenerateContent(
            activity.activity_uuid,
            activity.name,
            activity.description,
            chapter.name
          )
          // Small delay between generations to avoid rate limits
          await new Promise((resolve) => setTimeout(resolve, 1000))
        }
      }
    }
  }

  const totalActivities = chapters.reduce((sum, ch) => sum + ch.activities.length, 0)
  const generatedCount = Object.values(activityStates).filter((s) => s.isGenerated).length
  const isAnyGenerating = Object.values(activityStates).some((s) => s.isGenerating)

  return (
    <div className="absolute inset-0 overflow-y-auto p-6 scrollbar-hide">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-lg font-semibold text-white">
            {t('courses.create.ai.generate_content')}
          </h3>
          <p className="text-sm text-white/50 mt-1">
            {t('courses.create.ai.generate_content_description')}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-white/40">
            {generatedCount}/{totalActivities} {t('courses.create.ai.generated')}
          </span>
          <button
            onClick={handleGenerateAllContent}
            disabled={isAnyGenerating || generatedCount === totalActivities}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all",
              isAnyGenerating || generatedCount === totalActivities
                ? "bg-white/5 text-white/30 cursor-not-allowed"
                : "bg-purple-500/20 text-purple-300 hover:bg-purple-500/30"
            )}
          >
            {isAnyGenerating ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Sparkles className="w-4 h-4" />
            )}
            {t('courses.create.ai.generate_all')}
          </button>
        </div>
      </div>

      {/* Chapters and Activities */}
      <div className="space-y-3">
        {chapters.map((chapter, chapterIndex) => (
          <div
            key={chapter.chapter_uuid}
            className="bg-white/5 rounded-xl ring-1 ring-inset ring-white/10 overflow-hidden"
          >
            {/* Chapter Header */}
            <div
              className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-white/5 transition-colors"
              onClick={() => toggleChapter(chapterIndex)}
            >
              {expandedChapters.has(chapterIndex) ? (
                <ChevronDown className="w-4 h-4 text-white/50" />
              ) : (
                <ChevronRight className="w-4 h-4 text-white/50" />
              )}
              <BookOpen className="w-4 h-4 text-purple-400" />
              <span className="flex-1 text-sm font-medium text-white">
                {chapter.name}
              </span>
              <span className="text-xs text-white/40">
                {chapter.activities.filter(a => activityStates[a.activity_uuid]?.isGenerated).length}/{chapter.activities.length}
              </span>
            </div>

            {/* Activities */}
            {expandedChapters.has(chapterIndex) && (
              <div className="px-4 pb-3 space-y-2">
                {chapter.activities.map((activity) => {
                  const state = activityStates[activity.activity_uuid]
                  const isGenerating = state?.isGenerating
                  const isGenerated = state?.isGenerated
                  const hasError = state?.error

                  return (
                    <div
                      key={activity.activity_uuid}
                      className={cn(
                        "flex items-center gap-3 p-3 rounded-lg ring-1 ring-inset transition-all",
                        isGenerated
                          ? "bg-green-500/10 ring-green-500/20"
                          : isGenerating
                          ? "bg-purple-500/10 ring-purple-500/20"
                          : hasError
                          ? "bg-red-500/10 ring-red-500/20"
                          : "bg-white/5 ring-white/5"
                      )}
                    >
                      <FileText className={cn(
                        "w-4 h-4",
                        isGenerated ? "text-green-400" : "text-white/40"
                      )} />
                      <div className="flex-1 min-w-0">
                        <span className="text-sm text-white/80 block truncate">
                          {activity.name}
                        </span>
                        {isGenerating && state?.streamContent && (
                          <div className="mt-2 max-h-20 overflow-hidden">
                            <pre className="text-[10px] text-white/30 font-mono whitespace-pre-wrap break-words">
                              {state.streamContent.slice(-200)}...
                            </pre>
                          </div>
                        )}
                        {hasError && (
                          <span className="text-xs text-red-400 mt-1 block">
                            {state.error}
                          </span>
                        )}
                      </div>
                      {isGenerated ? (
                        <div className="flex items-center gap-1 text-green-400">
                          <Check className="w-4 h-4" />
                          <span className="text-xs">{t('courses.create.ai.done')}</span>
                        </div>
                      ) : isGenerating ? (
                        <div className="flex items-center gap-1 text-purple-400">
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span className="text-xs">{t('courses.create.ai.generating_short')}</span>
                        </div>
                      ) : hasError ? (
                        <button
                          onClick={() => handleGenerateContent(
                            activity.activity_uuid,
                            activity.name,
                            activity.description,
                            chapter.name
                          )}
                          className="flex items-center gap-1 px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 rounded-lg text-xs text-red-300 hover:text-red-200 transition-colors ring-1 ring-inset ring-red-500/20"
                        >
                          <RotateCcw className="w-3 h-3" />
                          {t('courses.create.ai.retry')}
                        </button>
                      ) : (
                        <button
                          onClick={() => handleGenerateContent(
                            activity.activity_uuid,
                            activity.name,
                            activity.description,
                            chapter.name
                          )}
                          className="flex items-center gap-1 px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-xs text-white/60 hover:text-white/80 transition-colors"
                        >
                          <Play className="w-3 h-3" />
                          {t('courses.create.ai.generate')}
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Completion message */}
      {generatedCount === totalActivities && totalActivities > 0 && (
        <div className="mt-6 bg-green-500/10 rounded-xl p-4 ring-1 ring-inset ring-green-500/20">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-500/20 rounded-full">
              <Check className="w-5 h-5 text-green-400" />
            </div>
            <div>
              <h4 className="text-sm font-semibold text-green-300">
                {t('courses.create.ai.all_content_generated')}
              </h4>
              <p className="text-xs text-green-400/70 mt-1">
                {t('courses.create.ai.all_content_generated_hint')}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default ContentGenerationPanel
