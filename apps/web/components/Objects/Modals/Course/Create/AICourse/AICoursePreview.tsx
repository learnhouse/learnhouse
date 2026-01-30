'use client'
import React from 'react'
import { Loader2, BookOpen, FileText, Sparkles, ChevronRight, ChevronDown, GripVertical, Plus, Trash2, Edit2, Check, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import Image from 'next/image'
import lrnaiIcon from 'public/lrnai_icon.png'
import type { CoursePlan, ChapterPlan, ActivityPlan, CreatedChapter } from '@services/ai/courseplanning'
import ContentGenerationPanel from './ContentGenerationPanel'

interface AICoursePreviewProps {
  step: 'planning' | 'content'
  plan: CoursePlan | null
  createdChapters: CreatedChapter[]
  courseUuid: string | null
  sessionUuid: string | null
  accessToken: string
  onUpdatePlan: (plan: CoursePlan) => void
  isLoading: boolean
  streamingContent: string
}

function AICoursePreview({
  step,
  plan,
  createdChapters,
  courseUuid,
  sessionUuid,
  accessToken,
  onUpdatePlan,
  isLoading,
  streamingContent,
}: AICoursePreviewProps) {
  const { t } = useTranslation()

  if (step === 'content') {
    return (
      <ContentGenerationPanel
        chapters={createdChapters}
        courseUuid={courseUuid}
        sessionUuid={sessionUuid}
        accessToken={accessToken}
        courseName={plan?.name || ''}
        courseDescription={plan?.description || ''}
      />
    )
  }

  // Planning step
  return (
    <div className="absolute inset-0 overflow-y-auto p-6 scrollbar-hide">
      {/* Show loading state */}
      {isLoading && !plan && (
        <div className="flex flex-col items-center justify-center h-full">
          <div className="relative">
            <div
              style={{
                background: 'conic-gradient(from 32deg at 53.75% 50%, rgb(35, 40, 93) 4deg, rgba(20, 0, 52, 0.95) 59deg, rgba(164, 45, 238, 0.88) 281deg)',
              }}
              className="p-4 rounded-full drop-shadow-md animate-pulse"
            >
              <Image src={lrnaiIcon} alt="AI" width={32} height={32} />
            </div>
          </div>
          <p className="text-white/50 mt-4 text-sm">
            {t('courses.create.ai.generating_plan')}
          </p>
          {streamingContent && (
            <div className="mt-4 max-w-2xl max-h-[300px] overflow-hidden">
              <pre className="text-xs text-white/30 font-mono whitespace-pre-wrap break-words">
                {streamingContent.slice(-500)}...
              </pre>
            </div>
          )}
        </div>
      )}

      {/* Show plan editor when we have a plan */}
      {plan && (
        <CoursePlanEditor plan={plan} onUpdatePlan={onUpdatePlan} />
      )}

      {/* Empty state */}
      {!isLoading && !plan && (
        <div className="flex flex-col items-center justify-center h-full">
          <div
            style={{
              background: 'conic-gradient(from 32deg at 53.75% 50%, rgb(35, 40, 93) 4deg, rgba(20, 0, 52, 0.95) 59deg, rgba(164, 45, 238, 0.88) 281deg)',
            }}
            className="p-4 rounded-full drop-shadow-md"
          >
            <Image src={lrnaiIcon} alt="AI" width={32} height={32} />
          </div>
          <h3 className="text-white/80 font-semibold mt-4">
            {t('courses.create.ai.describe_course')}
          </h3>
          <p className="text-white/50 text-sm mt-2 text-center max-w-md">
            {t('courses.create.ai.describe_course_hint')}
          </p>
        </div>
      )}
    </div>
  )
}

interface CoursePlanEditorProps {
  plan: CoursePlan
  onUpdatePlan: (plan: CoursePlan) => void
}

function CoursePlanEditor({ plan, onUpdatePlan }: CoursePlanEditorProps) {
  const { t } = useTranslation()
  const [expandedChapters, setExpandedChapters] = React.useState<Set<number>>(new Set([0]))
  const [editingField, setEditingField] = React.useState<string | null>(null)
  const [editValue, setEditValue] = React.useState('')

  const toggleChapter = (index: number) => {
    const newExpanded = new Set(expandedChapters)
    if (newExpanded.has(index)) {
      newExpanded.delete(index)
    } else {
      newExpanded.add(index)
    }
    setExpandedChapters(newExpanded)
  }

  const startEditing = (field: string, value: string) => {
    setEditingField(field)
    setEditValue(value)
  }

  const saveEdit = () => {
    if (!editingField) return

    const parts = editingField.split('.')
    const updatedPlan = { ...plan }

    if (parts[0] === 'name') {
      updatedPlan.name = editValue
    } else if (parts[0] === 'description') {
      updatedPlan.description = editValue
    } else if (parts[0] === 'chapter') {
      const chapterIndex = parseInt(parts[1])
      const newChapters = [...updatedPlan.chapters]
      if (parts[2] === 'name') {
        newChapters[chapterIndex] = { ...newChapters[chapterIndex], name: editValue }
      } else if (parts[2] === 'description') {
        newChapters[chapterIndex] = { ...newChapters[chapterIndex], description: editValue }
      } else if (parts[2] === 'activity') {
        const activityIndex = parseInt(parts[3])
        const newActivities = [...newChapters[chapterIndex].activities]
        if (parts[4] === 'name') {
          newActivities[activityIndex] = { ...newActivities[activityIndex], name: editValue }
        } else if (parts[4] === 'description') {
          newActivities[activityIndex] = { ...newActivities[activityIndex], description: editValue }
        }
        newChapters[chapterIndex] = { ...newChapters[chapterIndex], activities: newActivities }
      }
      updatedPlan.chapters = newChapters
    }

    onUpdatePlan(updatedPlan)
    setEditingField(null)
    setEditValue('')
  }

  const cancelEdit = () => {
    setEditingField(null)
    setEditValue('')
  }

  const addChapter = () => {
    const newChapter: ChapterPlan = {
      name: `Chapter ${plan.chapters.length + 1}`,
      description: 'New chapter description',
      activities: []
    }
    onUpdatePlan({
      ...plan,
      chapters: [...plan.chapters, newChapter]
    })
    setExpandedChapters(new Set([...expandedChapters, plan.chapters.length]))
  }

  const removeChapter = (index: number) => {
    const newChapters = plan.chapters.filter((_, i) => i !== index)
    onUpdatePlan({ ...plan, chapters: newChapters })
  }

  const addActivity = (chapterIndex: number) => {
    const newActivity: ActivityPlan = {
      name: `Activity ${plan.chapters[chapterIndex].activities.length + 1}`,
      type: 'TYPE_DYNAMIC',
      description: 'New activity description',
      suggested_blocks: ['heading', 'paragraph']
    }
    const newChapters = [...plan.chapters]
    newChapters[chapterIndex] = {
      ...newChapters[chapterIndex],
      activities: [...newChapters[chapterIndex].activities, newActivity]
    }
    onUpdatePlan({ ...plan, chapters: newChapters })
  }

  const removeActivity = (chapterIndex: number, activityIndex: number) => {
    const newChapters = [...plan.chapters]
    newChapters[chapterIndex] = {
      ...newChapters[chapterIndex],
      activities: newChapters[chapterIndex].activities.filter((_, i) => i !== activityIndex)
    }
    onUpdatePlan({ ...plan, chapters: newChapters })
  }

  return (
    <div className="space-y-6">
      {/* Course Header */}
      <div className="bg-white/5 rounded-xl p-5 ring-1 ring-inset ring-white/10">
        <div className="flex items-start gap-4">
          <div
            style={{
              background: 'conic-gradient(from 32deg at 53.75% 50%, rgb(35, 40, 93) 4deg, rgba(20, 0, 52, 0.95) 59deg, rgba(164, 45, 238, 0.88) 281deg)',
            }}
            className="p-3 rounded-xl drop-shadow-md flex-shrink-0"
          >
            <BookOpen className="w-6 h-6 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            {editingField === 'name' ? (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  className="flex-1 bg-white/10 rounded-lg px-3 py-2 text-white text-lg font-semibold focus:outline-none focus:ring-2 focus:ring-purple-500"
                  autoFocus
                />
                <button onClick={saveEdit} className="p-2 hover:bg-white/10 rounded-lg">
                  <Check className="w-4 h-4 text-green-400" />
                </button>
                <button onClick={cancelEdit} className="p-2 hover:bg-white/10 rounded-lg">
                  <X className="w-4 h-4 text-red-400" />
                </button>
              </div>
            ) : (
              <h2
                onClick={() => startEditing('name', plan.name)}
                className="text-lg font-semibold text-white cursor-pointer hover:text-purple-300 transition-colors"
              >
                {plan.name}
                <Edit2 className="w-3 h-3 inline ml-2 opacity-50" />
              </h2>
            )}
            {editingField === 'description' ? (
              <div className="flex items-start gap-2 mt-2">
                <textarea
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  className="flex-1 bg-white/10 rounded-lg px-3 py-2 text-white/70 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 min-h-[60px]"
                  autoFocus
                />
                <div className="flex flex-col gap-1">
                  <button onClick={saveEdit} className="p-2 hover:bg-white/10 rounded-lg">
                    <Check className="w-4 h-4 text-green-400" />
                  </button>
                  <button onClick={cancelEdit} className="p-2 hover:bg-white/10 rounded-lg">
                    <X className="w-4 h-4 text-red-400" />
                  </button>
                </div>
              </div>
            ) : (
              <p
                onClick={() => startEditing('description', plan.description)}
                className="text-sm text-white/60 mt-1 cursor-pointer hover:text-white/80 transition-colors"
              >
                {plan.description}
                <Edit2 className="w-3 h-3 inline ml-2 opacity-50" />
              </p>
            )}
            {plan.learnings && (
              <div className="flex flex-wrap gap-1.5 mt-3">
                {plan.learnings.split(',').map((learning, i) => (
                  <span
                    key={i}
                    className="px-2 py-0.5 text-xs bg-purple-500/20 text-purple-300 rounded-full"
                  >
                    {learning.trim()}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Chapters */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white/70">
            {t('courses.create.ai.chapters')} ({plan.chapters.length})
          </h3>
          <button
            onClick={addChapter}
            className="flex items-center gap-1 text-xs text-purple-400 hover:text-purple-300 transition-colors"
          >
            <Plus className="w-3 h-3" />
            {t('courses.create.ai.add_chapter')}
          </button>
        </div>

        {plan.chapters.map((chapter, chapterIndex) => (
          <div
            key={chapterIndex}
            className="bg-white/5 rounded-xl ring-1 ring-inset ring-white/10 overflow-hidden"
          >
            {/* Chapter Header */}
            <div
              className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-white/5 transition-colors"
              onClick={() => toggleChapter(chapterIndex)}
            >
              <GripVertical className="w-4 h-4 text-white/30" />
              {expandedChapters.has(chapterIndex) ? (
                <ChevronDown className="w-4 h-4 text-white/50" />
              ) : (
                <ChevronRight className="w-4 h-4 text-white/50" />
              )}
              <BookOpen className="w-4 h-4 text-purple-400" />
              <div className="flex-1 min-w-0">
                {editingField === `chapter.${chapterIndex}.name` ? (
                  <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="text"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      className="flex-1 bg-white/10 rounded px-2 py-1 text-white text-sm focus:outline-none focus:ring-1 focus:ring-purple-500"
                      autoFocus
                    />
                    <button onClick={saveEdit} className="p-1 hover:bg-white/10 rounded">
                      <Check className="w-3 h-3 text-green-400" />
                    </button>
                    <button onClick={cancelEdit} className="p-1 hover:bg-white/10 rounded">
                      <X className="w-3 h-3 text-red-400" />
                    </button>
                  </div>
                ) : (
                  <span
                    onClick={(e) => {
                      e.stopPropagation()
                      startEditing(`chapter.${chapterIndex}.name`, chapter.name)
                    }}
                    className="text-sm font-medium text-white hover:text-purple-300 cursor-pointer"
                  >
                    {chapter.name}
                  </span>
                )}
              </div>
              <span className="text-xs text-white/40">
                {chapter.activities.length} {t('courses.create.ai.activities')}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  removeChapter(chapterIndex)
                }}
                className="p-1 hover:bg-red-500/20 rounded transition-colors"
              >
                <Trash2 className="w-3 h-3 text-red-400" />
              </button>
            </div>

            {/* Activities */}
            {expandedChapters.has(chapterIndex) && (
              <div className="px-4 pb-3 space-y-2">
                {chapter.activities.map((activity, activityIndex) => (
                  <div
                    key={activityIndex}
                    className="flex items-start gap-3 p-3 bg-white/5 rounded-lg ring-1 ring-inset ring-white/5"
                  >
                    <GripVertical className="w-4 h-4 text-white/20 mt-0.5" />
                    <FileText className="w-4 h-4 text-white/40 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      {editingField === `chapter.${chapterIndex}.activity.${activityIndex}.name` ? (
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            className="flex-1 bg-white/10 rounded px-2 py-1 text-white text-sm focus:outline-none focus:ring-1 focus:ring-purple-500"
                            autoFocus
                          />
                          <button onClick={saveEdit} className="p-1 hover:bg-white/10 rounded">
                            <Check className="w-3 h-3 text-green-400" />
                          </button>
                          <button onClick={cancelEdit} className="p-1 hover:bg-white/10 rounded">
                            <X className="w-3 h-3 text-red-400" />
                          </button>
                        </div>
                      ) : (
                        <span
                          onClick={() => startEditing(`chapter.${chapterIndex}.activity.${activityIndex}.name`, activity.name)}
                          className="text-sm text-white/80 hover:text-purple-300 cursor-pointer"
                        >
                          {activity.name}
                        </span>
                      )}
                      <p className="text-xs text-white/40 mt-1 line-clamp-2">
                        {activity.description}
                      </p>
                      {activity.suggested_blocks.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {activity.suggested_blocks.slice(0, 4).map((block, i) => (
                            <span
                              key={i}
                              className="px-1.5 py-0.5 text-[10px] bg-white/10 text-white/50 rounded"
                            >
                              {block}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => removeActivity(chapterIndex, activityIndex)}
                      className="p-1 hover:bg-red-500/20 rounded transition-colors"
                    >
                      <Trash2 className="w-3 h-3 text-red-400" />
                    </button>
                  </div>
                ))}
                <button
                  onClick={() => addActivity(chapterIndex)}
                  className="flex items-center gap-1 w-full justify-center py-2 text-xs text-white/40 hover:text-purple-400 hover:bg-white/5 rounded-lg transition-colors"
                >
                  <Plus className="w-3 h-3" />
                  {t('courses.create.ai.add_activity')}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

export default AICoursePreview
