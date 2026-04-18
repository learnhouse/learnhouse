'use client'
import React from 'react'
import {
  Loader2, BookOpen, FileText, ChevronRight, ChevronDown,
  Plus, Trash2, Check, Sparkles, Play, RotateCcw, ArrowUpRight,
  LayoutList, Wand2,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import Image from 'next/image'
import lrnaiIcon from 'public/lrnai_icon.png'
import toast from 'react-hot-toast'
import type { CoursePlan, ChapterPlan, ActivityPlan, CreatedChapter } from '@services/ai/courseplanning'
import {
  generateActivityContent,
  parseActivityContentFromStream,
  ENABLE_ACTIVITY_CONTENT_GENERATION,
} from '@services/ai/courseplanning'
import { updateActivity } from '@services/courses/activities'

interface AICoursePreviewProps {
  plan: CoursePlan | null
  createdChapters: CreatedChapter[]
  courseUuid: string | null
  sessionUuid: string | null
  accessToken: string
  onUpdatePlan: (plan: CoursePlan) => void
  isLoading: boolean
  streamingContent: string
  isCourseCreated: boolean
  onCreateCourse: () => void
  isCreatingCourse: boolean
  onOpenInEditor: () => void
}

interface ActivityGenState {
  isGenerating: boolean
  isGenerated: boolean
  streamContent: string
  error: string | null
}

type LeftTab = 'plan' | 'content'

function AICoursePreview({
  plan,
  createdChapters,
  courseUuid,
  sessionUuid,
  accessToken,
  onUpdatePlan,
  isLoading,
  streamingContent,
  isCourseCreated,
  onCreateCourse,
  isCreatingCourse,
  onOpenInEditor,
}: AICoursePreviewProps) {
  const { t } = useTranslation()
  const [activeTab, setActiveTab] = React.useState<LeftTab>('plan')
  const [activityStates, setActivityStates] = React.useState<Record<string, ActivityGenState>>({})

  const totalActivities = createdChapters.reduce((sum, ch) => sum + ch.activities.length, 0)
  const generatedCount = Object.values(activityStates).filter((s) => s.isGenerated).length
  const isAnyGenerating = Object.values(activityStates).some((s) => s.isGenerating)

  const handleGenerateContent = async (
    activityUuid: string,
    activityName: string,
    activityDescription: string,
    chapterName: string
  ) => {
    if (!sessionUuid || !plan) return

    setActivityStates((prev) => ({
      ...prev,
      [activityUuid]: { isGenerating: true, isGenerated: false, streamContent: '', error: null },
    }))

    let fullContent = ''

    const onChunk = (chunk: string) => {
      fullContent += chunk
      setActivityStates((prev) => ({
        ...prev,
        [activityUuid]: { ...prev[activityUuid], streamContent: fullContent },
      }))
    }

    const onComplete = async () => {
      const parsedContent = parseActivityContentFromStream(fullContent)
      if (parsedContent) {
        try {
          const result = await updateActivity({ content: parsedContent }, activityUuid, accessToken)
          if (result.success) {
            setActivityStates((prev) => ({
              ...prev,
              [activityUuid]: { isGenerating: false, isGenerated: true, streamContent: '', error: null },
            }))
          } else {
            throw new Error(result.data?.detail || 'Failed to save content')
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Failed to save'
          setActivityStates((prev) => ({
            ...prev,
            [activityUuid]: { isGenerating: false, isGenerated: false, streamContent: '', error: errorMsg },
          }))
          toast.error(errorMsg)
        }
      } else {
        setActivityStates((prev) => ({
          ...prev,
          [activityUuid]: { isGenerating: false, isGenerated: false, streamContent: '', error: 'Failed to parse content' },
        }))
        toast.error(t('courses.create.ai.content_parse_error'))
      }
    }

    const onError = (error: string) => {
      setActivityStates((prev) => ({
        ...prev,
        [activityUuid]: { isGenerating: false, isGenerated: false, streamContent: '', error },
      }))
      toast.error(error)
    }

    try {
      await generateActivityContent(
        sessionUuid, activityUuid, activityName, activityDescription,
        chapterName, plan.name, plan.description, accessToken,
        onChunk, onComplete, onError
      )
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Unknown error')
    }
  }

  const handleGenerateAll = async () => {
    for (const chapter of createdChapters) {
      for (const activity of chapter.activities) {
        const state = activityStates[activity.activity_uuid]
        if (!state?.isGenerated && !state?.isGenerating) {
          await handleGenerateContent(activity.activity_uuid, activity.name, activity.description, chapter.name)
          await new Promise((resolve) => setTimeout(resolve, 1000))
        }
      }
    }
  }

  // The tabs + content are ALWAYS rendered with the same structure
  return (
    <div className="absolute inset-0 flex flex-col">
      {/* Tab bar - always visible, full width */}
      <div className="flex flex-shrink-0 border-b border-white/5">
        <button
          onClick={() => setActiveTab('plan')}
          className={cn(
            "flex-1 flex items-center justify-center gap-2 py-2.5 text-xs font-semibold transition-all",
            activeTab === 'plan'
              ? "text-white/90 border-b-2 border-purple-500 bg-white/[0.03]"
              : "text-white/40 hover:text-white/60 hover:bg-white/[0.02]"
          )}
        >
          <LayoutList className="w-3.5 h-3.5" />
          {t('courses.create.ai.tab_plan')}
        </button>
        {ENABLE_ACTIVITY_CONTENT_GENERATION && (
          <button
            onClick={() => setActiveTab('content')}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 py-2.5 text-xs font-semibold transition-all",
              activeTab === 'content'
                ? "text-white/90 border-b-2 border-purple-500 bg-white/[0.03]"
                : "text-white/40 hover:text-white/60 hover:bg-white/[0.02]"
            )}
          >
            <Wand2 className="w-3.5 h-3.5" />
            {t('courses.create.ai.tab_content')}
            {totalActivities > 0 && (
              <span className={cn(
                "ms-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold",
                generatedCount === totalActivities && totalActivities > 0
                  ? "bg-green-500/20 text-green-300"
                  : "bg-white/10 text-white/40"
              )}>
                {generatedCount}/{totalActivities}
              </span>
            )}
          </button>
        )}
      </div>

      {/* Tab content */}
      <div className="flex-1 relative overflow-hidden">
        {activeTab === 'plan' ? (
          <PlanTabContent
            plan={plan}
            onUpdatePlan={onUpdatePlan}
            isLoading={isLoading}
            streamingContent={streamingContent}
            isCourseCreated={isCourseCreated}
            onCreateCourse={onCreateCourse}
            isCreatingCourse={isCreatingCourse}
            onOpenInEditor={onOpenInEditor}
          />
        ) : (
          <ContentTabContent
            plan={plan}
            createdChapters={createdChapters}
            isCourseCreated={isCourseCreated}
            activityStates={activityStates}
            onGenerateContent={handleGenerateContent}
            onGenerateAll={handleGenerateAll}
            totalActivities={totalActivities}
            generatedCount={generatedCount}
            isAnyGenerating={isAnyGenerating}
            onOpenInEditor={onOpenInEditor}
          />
        )}
      </div>
    </div>
  )
}

// ────────────────────────────────────────
// Plan tab content
// ────────────────────────────────────────

function PlanTabContent({
  plan,
  onUpdatePlan,
  isLoading,
  streamingContent,
  isCourseCreated,
  onCreateCourse,
  isCreatingCourse,
  onOpenInEditor,
}: {
  plan: CoursePlan | null
  onUpdatePlan: (plan: CoursePlan) => void
  isLoading: boolean
  streamingContent: string
  isCourseCreated: boolean
  onCreateCourse: () => void
  isCreatingCourse: boolean
  onOpenInEditor: () => void
}) {
  const { t } = useTranslation()

  // Loading first generation
  if (isLoading && !plan) {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div
          style={{ background: 'conic-gradient(from 32deg at 53.75% 50%, rgb(35, 40, 93) 4deg, rgba(20, 0, 52, 0.95) 59deg, rgba(164, 45, 238, 0.88) 281deg)' }}
          className="p-4 rounded-full drop-shadow-md animate-pulse"
        >
          <Image src={lrnaiIcon} alt="AI" width={32} height={32} />
        </div>
        <p className="text-white/50 mt-4 text-sm">{t('courses.create.ai.generating_plan')}</p>
        {streamingContent && (
          <div className="mt-4 max-w-2xl max-h-[300px] overflow-hidden">
            <pre className="text-xs text-white/30 font-mono whitespace-pre-wrap break-words">
              {streamingContent.slice(-500)}...
            </pre>
          </div>
        )}
      </div>
    )
  }

  // No plan yet
  if (!plan) {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div
          style={{ background: 'conic-gradient(from 32deg at 53.75% 50%, rgb(35, 40, 93) 4deg, rgba(20, 0, 52, 0.95) 59deg, rgba(164, 45, 238, 0.88) 281deg)' }}
          className="p-4 rounded-full drop-shadow-md"
        >
          <Image src={lrnaiIcon} alt="AI" width={32} height={32} />
        </div>
        <h3 className="text-white/80 font-semibold mt-4">{t('courses.create.ai.describe_course')}</h3>
        <p className="text-white/50 text-sm mt-2 text-center max-w-md">{t('courses.create.ai.describe_course_hint')}</p>
      </div>
    )
  }

  return (
    <div className="absolute inset-0 overflow-y-auto p-6 scrollbar-hide">
      <div className="max-w-3xl mx-auto space-y-5">
        {/* Course header */}
        <CoursePlanHeader plan={plan} onUpdatePlan={onUpdatePlan} />

        {/* Chapters */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white/70">
              {t('courses.create.ai.chapters')} ({plan.chapters.length})
            </h3>
            <button
              onClick={() => {
                const newChapter: ChapterPlan = { name: `Chapter ${plan.chapters.length + 1}`, description: 'New chapter', activities: [] }
                onUpdatePlan({ ...plan, chapters: [...plan.chapters, newChapter] })
              }}
              className="flex items-center gap-1 text-xs text-purple-400 hover:text-purple-300 transition-colors"
            >
              <Plus className="w-3 h-3" />
              {t('courses.create.ai.add_chapter')}
            </button>
          </div>

          {plan.chapters.map((chapter, ci) => (
            <PlanChapterCard key={ci} chapter={chapter} chapterIndex={ci} plan={plan} onUpdatePlan={onUpdatePlan} />
          ))}
        </div>

        {/* Bottom actions - always visible */}
        <div className="pt-4 pb-8 flex justify-center gap-3">
          {!isCourseCreated ? (
            <button
              onClick={onCreateCourse}
              disabled={isCreatingCourse || isLoading}
              className={cn(
                "flex items-center gap-2 px-8 py-3 rounded-xl text-sm font-semibold transition-all",
                (isCreatingCourse || isLoading)
                  ? "bg-white/5 text-white/30 cursor-not-allowed"
                  : "bg-purple-500/20 text-purple-300 hover:bg-purple-500/30 outline outline-1 outline-purple-500/30"
              )}
            >
              {isCreatingCourse ? (
                <><Loader2 className="w-4 h-4 animate-spin" />{t('courses.create.ai.creating_structure')}</>
              ) : (
                t('courses.create.ai.create_course')
              )}
            </button>
          ) : (
            <button
              onClick={onOpenInEditor}
              className="flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold bg-green-500/20 text-green-300 hover:bg-green-500/30 outline outline-1 outline-green-500/30 transition-all"
            >
              {t('courses.create.ai.open_in_editor')}
              <ArrowUpRight className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ────────────────────────────────────────
// Content tab content
// ────────────────────────────────────────

function ContentTabContent({
  plan,
  createdChapters,
  isCourseCreated,
  activityStates,
  onGenerateContent,
  onGenerateAll,
  totalActivities,
  generatedCount,
  isAnyGenerating,
  onOpenInEditor,
}: {
  plan: CoursePlan | null
  createdChapters: CreatedChapter[]
  isCourseCreated: boolean
  activityStates: Record<string, ActivityGenState>
  onGenerateContent: (uuid: string, name: string, desc: string, chapterName: string) => void
  onGenerateAll: () => void
  totalActivities: number
  generatedCount: number
  isAnyGenerating: boolean
  onOpenInEditor: () => void
}) {
  const { t } = useTranslation()
  const [expandedChapters, setExpandedChapters] = React.useState<Set<number>>(new Set())

  // Use plan chapters as the source (always available), overlay with createdChapters data when available
  const chapters = plan?.chapters || []

  React.useEffect(() => {
    if (chapters.length > 0) {
      setExpandedChapters(new Set(chapters.map((_, i) => i)))
    }
  }, [chapters.length])

  const toggleChapter = (index: number) => {
    const newExpanded = new Set(expandedChapters)
    if (newExpanded.has(index)) newExpanded.delete(index)
    else newExpanded.add(index)
    setExpandedChapters(newExpanded)
  }

  // No plan yet - empty state
  if (!plan || chapters.length === 0) {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center px-8">
        <div className="p-4 rounded-full bg-white/5 mb-4">
          <Wand2 className="w-7 h-7 text-white/30" />
        </div>
        <p className="text-white/40 text-sm text-center max-w-sm">
          {t('courses.create.ai.content_empty_hint')}
        </p>
      </div>
    )
  }

  return (
    <div className="absolute inset-0 overflow-y-auto p-6 scrollbar-hide">
      <div className="max-w-3xl mx-auto space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-white">{t('courses.create.ai.generate_content')}</h3>
            <p className="text-xs text-white/40 mt-1">{t('courses.create.ai.generate_content_description')}</p>
          </div>
          <div className="flex items-center gap-3">
            {isCourseCreated && (
              <span className="text-xs text-white/40 tabular-nums">
                {generatedCount}/{totalActivities} {t('courses.create.ai.generated')}
              </span>
            )}
            <button
              onClick={onGenerateAll}
              disabled={!isCourseCreated || isAnyGenerating || generatedCount === totalActivities}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all",
                (!isCourseCreated || isAnyGenerating || generatedCount === totalActivities)
                  ? "bg-white/5 text-white/30 cursor-not-allowed"
                  : "bg-purple-500/20 text-purple-300 hover:bg-purple-500/30 outline outline-1 outline-purple-500/30"
              )}
            >
              {isAnyGenerating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
              {t('courses.create.ai.generate_all')}
            </button>
          </div>
        </div>

        {/* Chapters and activities - always rendered from plan */}
        <div className="space-y-3">
          {chapters.map((chapter, ci) => {
            const createdChapter = createdChapters[ci]
            const genInChapter = createdChapter
              ? createdChapter.activities.filter(a => activityStates[a.activity_uuid]?.isGenerated).length
              : 0

            return (
              <div key={ci} className="bg-white/5 rounded-xl ring-1 ring-inset ring-white/10 overflow-hidden">
                <div
                  className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-white/5 transition-colors"
                  onClick={() => toggleChapter(ci)}
                >
                  {expandedChapters.has(ci) ? <ChevronDown className="w-4 h-4 text-white/50" /> : <ChevronRight className="w-4 h-4 text-white/50" />}
                  <BookOpen className="w-4 h-4 text-purple-400" />
                  <span className="flex-1 text-sm font-medium text-white">{chapter.name}</span>
                  <span className="text-xs text-white/40 tabular-nums">
                    {isCourseCreated && createdChapter
                      ? `${genInChapter}/${chapter.activities.length}`
                      : `${chapter.activities.length} ${t('courses.create.ai.activities')}`
                    }
                  </span>
                </div>

                {expandedChapters.has(ci) && (
                  <div className="px-4 pb-3 space-y-2">
                    {chapter.activities.map((activity, ai) => {
                      const createdActivity = createdChapter?.activities[ai]
                      const state = createdActivity ? activityStates[createdActivity.activity_uuid] : null
                      const isGenerating = state?.isGenerating
                      const isGenerated = state?.isGenerated
                      const hasError = state?.error
                      const canGenerate = isCourseCreated && createdActivity

                      return (
                        <div
                          key={ai}
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
                          <FileText className={cn("w-4 h-4 flex-shrink-0", isGenerated ? "text-green-400" : "text-white/40")} />
                          <div className="flex-1 min-w-0">
                            <span className="text-sm text-white/80 block truncate">{activity.name}</span>
                            {activity.description && <p className="text-xs text-white/30 mt-0.5 line-clamp-1">{activity.description}</p>}
                            {isGenerating && state?.streamContent && (
                              <div className="mt-2 max-h-16 overflow-hidden">
                                <pre className="text-[10px] text-white/30 font-mono whitespace-pre-wrap break-words">
                                  {state.streamContent.slice(-150)}
                                </pre>
                              </div>
                            )}
                            {hasError && <span className="text-xs text-red-400 mt-1 block">{state?.error}</span>}
                          </div>

                          {isGenerated ? (
                            <div className="flex items-center gap-1 text-green-400 flex-shrink-0">
                              <Check className="w-3.5 h-3.5" />
                              <span className="text-xs">{t('courses.create.ai.done')}</span>
                            </div>
                          ) : isGenerating ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-purple-400 flex-shrink-0" />
                          ) : hasError ? (
                            <button
                              onClick={() => createdActivity && onGenerateContent(createdActivity.activity_uuid, activity.name, activity.description, chapter.name)}
                              className="flex items-center gap-1 px-2 py-1 rounded-md text-xs text-red-300 hover:bg-red-500/20 transition-colors flex-shrink-0"
                            >
                              <RotateCcw className="w-3 h-3" />
                              {t('courses.create.ai.retry')}
                            </button>
                          ) : (
                            <button
                              onClick={() => canGenerate && onGenerateContent(createdActivity!.activity_uuid, activity.name, activity.description, chapter.name)}
                              disabled={!canGenerate}
                              className={cn(
                                "flex items-center gap-1 px-2.5 py-1 rounded-md text-xs transition-colors flex-shrink-0",
                                canGenerate
                                  ? "text-white/50 hover:text-purple-300 hover:bg-white/5"
                                  : "text-white/20 cursor-not-allowed"
                              )}
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
            )
          })}
        </div>

        {/* All done */}
        {isCourseCreated && generatedCount === totalActivities && totalActivities > 0 && (
          <div className="bg-green-500/10 rounded-xl p-4 ring-1 ring-inset ring-green-500/20">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-500/20 rounded-full"><Check className="w-5 h-5 text-green-400" /></div>
              <div className="flex-1">
                <h4 className="text-sm font-semibold text-green-300">{t('courses.create.ai.all_content_generated')}</h4>
                <p className="text-xs text-green-400/70 mt-1">{t('courses.create.ai.all_content_generated_hint')}</p>
              </div>
              <button
                onClick={onOpenInEditor}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-green-500/20 text-green-300 hover:bg-green-500/30 outline outline-1 outline-green-500/30 transition-all"
              >
                {t('courses.create.ai.open_in_editor')}
                <ArrowUpRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ────────────────────────────────────────
// Course header card - always editable
// ────────────────────────────────────────

function CoursePlanHeader({ plan, onUpdatePlan }: { plan: CoursePlan; onUpdatePlan: (plan: CoursePlan) => void }) {
  const [editingName, setEditingName] = React.useState(false)
  const [editingDesc, setEditingDesc] = React.useState(false)
  const [nameValue, setNameValue] = React.useState(plan.name)
  const [descValue, setDescValue] = React.useState(plan.description)

  React.useEffect(() => { setNameValue(plan.name); setDescValue(plan.description) }, [plan.name, plan.description])

  const saveName = () => { if (nameValue.trim()) onUpdatePlan({ ...plan, name: nameValue.trim() }); setEditingName(false) }
  const saveDesc = () => { onUpdatePlan({ ...plan, description: descValue.trim() }); setEditingDesc(false) }

  return (
    <div className="bg-white/5 rounded-xl p-5 ring-1 ring-inset ring-white/10">
      <div className="flex items-start gap-4">
        <div
          style={{ background: 'conic-gradient(from 32deg at 53.75% 50%, rgb(35, 40, 93) 4deg, rgba(20, 0, 52, 0.95) 59deg, rgba(164, 45, 238, 0.88) 281deg)' }}
          className="p-3 rounded-xl drop-shadow-md flex-shrink-0"
        >
          <BookOpen className="w-6 h-6 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          {editingName ? (
            <input
              type="text" value={nameValue} onChange={(e) => setNameValue(e.target.value)} onBlur={saveName}
              onKeyDown={(e) => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') { setNameValue(plan.name); setEditingName(false) } }}
              className="w-full bg-white/10 rounded-lg px-3 py-2 text-white text-lg font-semibold focus:outline-none focus:ring-2 focus:ring-purple-500" autoFocus
            />
          ) : (
            <h2 onClick={() => setEditingName(true)} className="text-lg font-semibold text-white cursor-pointer hover:text-purple-300 transition-colors">
              {plan.name}
            </h2>
          )}

          {editingDesc ? (
            <textarea
              value={descValue} onChange={(e) => setDescValue(e.target.value)} onBlur={saveDesc}
              onKeyDown={(e) => { if (e.key === 'Escape') { setDescValue(plan.description); setEditingDesc(false) } }}
              className="w-full mt-2 bg-white/10 rounded-lg px-3 py-2 text-white/70 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 min-h-[60px] resize-none" autoFocus
            />
          ) : (
            <p onClick={() => setEditingDesc(true)} className="text-sm text-white/60 mt-1 cursor-pointer hover:text-white/80 transition-colors">
              {plan.description}
            </p>
          )}

          {plan.learnings && (
            <div className="flex flex-wrap gap-1.5 mt-3">
              {plan.learnings.split(',').map((l, i) => (
                <span key={i} className="px-2 py-0.5 text-xs bg-purple-500/20 text-purple-300 rounded-full">{l.trim()}</span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ────────────────────────────────────────
// Plan chapter card - always editable
// ────────────────────────────────────────

function PlanChapterCard({ chapter, chapterIndex, plan, onUpdatePlan }: {
  chapter: ChapterPlan; chapterIndex: number; plan: CoursePlan; onUpdatePlan: (plan: CoursePlan) => void
}) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = React.useState(chapterIndex === 0)
  const [editingName, setEditingName] = React.useState(false)
  const [nameValue, setNameValue] = React.useState(chapter.name)

  React.useEffect(() => setNameValue(chapter.name), [chapter.name])

  const saveName = () => {
    if (nameValue.trim()) {
      const c = [...plan.chapters]; c[chapterIndex] = { ...c[chapterIndex], name: nameValue.trim() }
      onUpdatePlan({ ...plan, chapters: c })
    }
    setEditingName(false)
  }

  return (
    <div className="bg-white/5 rounded-xl ring-1 ring-inset ring-white/10 overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-white/5 transition-colors" onClick={() => setExpanded(!expanded)}>
        {expanded ? <ChevronDown className="w-4 h-4 text-white/50" /> : <ChevronRight className="w-4 h-4 text-white/50" />}
        <BookOpen className="w-4 h-4 text-purple-400" />
        <div className="flex-1 min-w-0">
          {editingName ? (
            <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
              <input type="text" value={nameValue} onChange={(e) => setNameValue(e.target.value)} onBlur={saveName}
                onKeyDown={(e) => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') { setNameValue(chapter.name); setEditingName(false) } }}
                className="flex-1 bg-white/10 rounded px-2 py-1 text-white text-sm focus:outline-none focus:ring-1 focus:ring-purple-500" autoFocus />
            </div>
          ) : (
            <span onClick={(e) => { e.stopPropagation(); setEditingName(true) }} className="text-sm font-medium text-white hover:text-purple-300 cursor-pointer">
              {chapter.name}
            </span>
          )}
        </div>
        <span className="text-xs text-white/40">{chapter.activities.length} {t('courses.create.ai.activities')}</span>
        <button onClick={(e) => { e.stopPropagation(); onUpdatePlan({ ...plan, chapters: plan.chapters.filter((_, i) => i !== chapterIndex) }) }}
          className="p-1 hover:bg-red-500/20 rounded transition-colors">
          <Trash2 className="w-3 h-3 text-red-400" />
        </button>
      </div>

      {expanded && (
        <div className="px-4 pb-3 space-y-2">
          {chapter.activities.map((activity, ai) => (
            <PlanActivityItem
              key={ai}
              activity={activity}
              activityIndex={ai}
              chapterIndex={chapterIndex}
              plan={plan}
              onUpdatePlan={onUpdatePlan}
            />
          ))}

          <button
            onClick={() => {
              const newAct: ActivityPlan = { name: `Activity ${chapter.activities.length + 1}`, type: 'TYPE_DYNAMIC', description: 'New activity', suggested_blocks: ['heading', 'paragraph'] }
              const c = [...plan.chapters]; c[chapterIndex] = { ...c[chapterIndex], activities: [...c[chapterIndex].activities, newAct] }
              onUpdatePlan({ ...plan, chapters: c })
            }}
            className="flex items-center gap-1 w-full justify-center py-2 text-xs text-white/40 hover:text-purple-400 hover:bg-white/5 rounded-lg transition-colors"
          >
            <Plus className="w-3 h-3" />
            {t('courses.create.ai.add_activity')}
          </button>
        </div>
      )}
    </div>
  )
}

// ────────────────────────────────────────
// Plan activity item - extracted to fix hooks-in-map
// ────────────────────────────────────────

function PlanActivityItem({ activity, activityIndex, chapterIndex, plan, onUpdatePlan }: {
  activity: ActivityPlan; activityIndex: number; chapterIndex: number; plan: CoursePlan; onUpdatePlan: (plan: CoursePlan) => void
}) {
  const [editing, setEditing] = React.useState(false)
  const [val, setVal] = React.useState(activity.name)
  React.useEffect(() => setVal(activity.name), [activity.name])

  const save = () => {
    if (val.trim()) {
      const c = [...plan.chapters]; const a = [...c[chapterIndex].activities]
      a[activityIndex] = { ...a[activityIndex], name: val.trim() }; c[chapterIndex] = { ...c[chapterIndex], activities: a }
      onUpdatePlan({ ...plan, chapters: c })
    }
    setEditing(false)
  }

  const remove = () => {
    const c = [...plan.chapters]
    c[chapterIndex] = { ...c[chapterIndex], activities: c[chapterIndex].activities.filter((_, i) => i !== activityIndex) }
    onUpdatePlan({ ...plan, chapters: c })
  }

  return (
    <div className="flex items-start gap-3 p-3 bg-white/5 rounded-lg ring-1 ring-inset ring-white/5">
      <FileText className="w-4 h-4 text-white/40 mt-0.5 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        {editing ? (
          <input type="text" value={val} onChange={(e) => setVal(e.target.value)} onBlur={save}
            onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { setVal(activity.name); setEditing(false) } }}
            className="w-full bg-white/10 rounded px-2 py-1 text-white text-sm focus:outline-none focus:ring-1 focus:ring-purple-500" autoFocus />
        ) : (
          <span onClick={() => setEditing(true)} className="text-sm text-white/80 hover:text-purple-300 cursor-pointer">{activity.name}</span>
        )}
        {activity.description && <p className="text-xs text-white/40 mt-0.5 line-clamp-1">{activity.description}</p>}
      </div>
      <button onClick={remove} className="p-1 hover:bg-red-500/20 rounded transition-colors flex-shrink-0">
        <Trash2 className="w-3 h-3 text-red-400" />
      </button>
    </div>
  )
}

export default AICoursePreview
