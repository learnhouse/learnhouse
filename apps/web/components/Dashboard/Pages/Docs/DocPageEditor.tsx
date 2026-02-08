'use client'

import React, { useEffect, useState, useCallback } from 'react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { updateDocPage } from '@services/docs/docpages'
import { getAPIUrl } from '@services/config/config'
import { swrFetcher } from '@services/utils/ts/requests'
import useSWR, { mutate } from 'swr'
import toast from 'react-hot-toast'
import { Switch } from '@components/ui/switch'
import {
  FileText,
  Link as LinkIcon,
  Code,
  Layers,
  ExternalLink,
  Save,
  Search,
  ChevronRight,
  ChevronDown,
  Video,
  FileType,
  BookOpen,
  Check,
  RefreshCw,
  ArrowLeft,
  Eye,
  Users,
  MessageCircle,
} from 'lucide-react'
import IconPicker from '@components/Objects/Docs/IconPicker'
import dynamic from 'next/dynamic'
import NextLink from 'next/link'
import Image from 'next/image'
import { motion } from 'framer-motion'
import { DividerVerticalIcon } from '@radix-ui/react-icons'
import DocToolbar from '@components/Objects/Docs/Editor/Toolbar/DocToolbar'

const DocTiptapEditor = dynamic(
  () => import('@components/Objects/Docs/Editor/DocTiptapEditor'),
  { ssr: false }
)

interface DocPageEditorProps {
  pageuuid: string
  spaceuuid: string
  orgId: number
  orgslug: string
}

const DocPageEditor = ({ pageuuid, spaceuuid, orgId, orgslug }: DocPageEditorProps) => {
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token

  const { data: page, error, isLoading } = useSWR(
    access_token ? `${getAPIUrl()}docs/pages/${pageuuid}` : null,
    (url: string) => swrFetcher(url, access_token),
    { revalidateOnFocus: false }
  )

  const { data: spaceMeta } = useSWR(
    access_token ? `${getAPIUrl()}docs/${spaceuuid}/meta` : null,
    (url: string) => swrFetcher(url, access_token),
    { revalidateOnFocus: false }
  )

  const previewUrl = React.useMemo(() => {
    if (!spaceMeta || !page) return `/docs/${spaceuuid}`
    const spaceSlug = spaceMeta.slug
    for (const section of spaceMeta.sections || []) {
      // Check ungrouped pages
      for (const p of section.pages || []) {
        if (p.docpage_uuid === pageuuid) {
          return `/docs/${spaceSlug}/${section.slug}/${p.slug}`
        }
      }
      // Check grouped pages
      for (const group of section.groups || []) {
        for (const p of group.pages || []) {
          if (p.docpage_uuid === pageuuid) {
            return `/docs/${spaceSlug}/${section.slug}/${p.slug}`
          }
        }
      }
    }
    return `/docs/${spaceSlug}`
  }, [spaceMeta, page, spaceuuid, pageuuid])

  const [name, setName] = useState('')
  const [icon, setIcon] = useState<string | null>(null)
  const [published, setPublished] = useState(false)
  const [content, setContent] = useState<any>({})
  const [isSaving, setIsSaving] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)
  const [tiptapEditor, setTiptapEditor] = useState<any>(null)

  useEffect(() => {
    if (page) {
      setName(page.name || '')
      setIcon(page.icon || null)
      setPublished(page.published || false)
      setContent(page.content || {})
      setHasChanges(false)
    }
  }, [page])

  const markChanged = useCallback(() => {
    setHasChanges(true)
  }, [])

  const handleSave = async () => {
    setIsSaving(true)
    try {
      await updateDocPage(
        pageuuid,
        { name, icon, published, content } as any,
        access_token
      )
      toast.success('Page saved')
      setHasChanges(false)
      mutate(`${getAPIUrl()}docs/${spaceuuid}/meta`)
    } catch {
      toast.error('Failed to save page')
    } finally {
      setIsSaving(false)
    }
  }

  if (isLoading) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-[#f8f8f8]">
        <div className="text-gray-400 text-sm">Loading page...</div>
      </div>
    )
  }

  if (error || !page) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-[#f8f8f8]">
        <div className="text-red-500 text-sm">Failed to load page.</div>
      </div>
    )
  }

  const pageType = page.page_type

  // Full-page editor layout for MARKDOWN pages (activity editor style)
  if (pageType === 'MARKDOWN') {
    return (
      <div className="doc-editor-page">
        {/* Floating top bar — exact same structure as activity EditorTop */}
        <div className="doc-editor-top">
          {/* Left: EditorDocSection */}
          <div className="doc-editor-doc-section">
            {/* Row 1: EditorInfoWrapper — logo + name */}
            <div className="doc-editor-info-wrapper">
              <NextLink href="/">
                <div className="bg-black rounded-md w-[25px] h-[25px] flex items-center justify-center overflow-hidden flex-shrink-0">
                  <motion.div
                    initial={{ y: 20 }}
                    animate={{ y: 0 }}
                    transition={{ delay: 1, type: 'spring', stiffness: 120, damping: 20 }}
                  >
                    <Image src="/lrn.svg" alt="LearnHouse" width={14} height={14} className="invert" />
                  </motion.div>
                </div>
              </NextLink>
              <NextLink
                href={`/dash/docs/${spaceuuid}/structure`}
                className="doc-editor-back-link"
              >
                <ArrowLeft size={14} />
              </NextLink>
              <div className="doc-editor-doc-name">
                <b>{name || 'Untitled'}</b>
              </div>
            </div>
            {/* Row 2: EditorButtonsWrapper — toolbar */}
            <div className="doc-editor-buttons-wrapper">
              <DocToolbar editor={tiptapEditor} />
            </div>
          </div>

          {/* Right: EditorUsersSection */}
          <div className="doc-editor-options-section">
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 whitespace-nowrap">Published</span>
              <Switch
                checked={published}
                onCheckedChange={(v) => {
                  setPublished(v)
                  markChanged()
                }}
              />
            </div>
            <DividerVerticalIcon
              style={{ marginTop: 'auto', marginBottom: 'auto', color: 'grey', opacity: '0.5' }}
            />
            <div className="flex items-center space-x-2">
              <div
                onClick={handleSave}
                className={`${
                  !hasChanges || isSaving ? 'opacity-50 cursor-not-allowed' : 'hover:cursor-pointer'
                } bg-sky-600 hover:bg-sky-700 transition-all ease-linear px-3 py-2 font-black text-sm shadow-sm text-white rounded-lg flex items-center gap-1.5`}
              >
                {isSaving ? 'Saving...' : 'Save'}
              </div>
              <NextLink target="_blank" href={previewUrl}>
                <div className="flex bg-neutral-600 hover:bg-neutral-700 transition-all ease-linear h-9 px-3 py-2 font-black justify-center items-center text-sm shadow-sm text-neutral-100 rounded-lg hover:cursor-pointer">
                  <Eye className="mx-auto items-center" size={15} />
                </div>
              </NextLink>
            </div>
          </div>
        </div>

        {/* Content wrapper with fade-in animation */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ type: 'spring', stiffness: 360, damping: 70, delay: 0.5 }}
          style={{ position: 'relative', margin: '0 40px' }}
        >
          <div className="doc-editor-content-wrapper">
            {/* Editable title inside the content area */}
            <div style={{ padding: '20px 20px 0 20px' }}>
              <div className="flex items-center gap-3">
                <IconPicker
                  value={icon}
                  onChange={(v) => {
                    setIcon(v)
                    markChanged()
                  }}
                />
                <input
                  type="text"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value)
                    markChanged()
                  }}
                  className="w-full text-[32px] font-semibold text-gray-900 border-0 outline-none bg-transparent placeholder:text-gray-300"
                  placeholder="Page title..."
                  style={{ marginBottom: '4px' }}
                />
              </div>
            </div>
            <DocTiptapEditor
              content={content?.tiptapContent || undefined}
              onUpdate={(json) => {
                setContent({ ...content, tiptapContent: json })
                markChanged()
              }}
              onEditorReady={setTiptapEditor}
            />
          </div>
        </motion.div>
      </div>
    )
  }

  // Card layout for non-MARKDOWN page types
  return (
    <div className="h-full w-full bg-[#f8f8f8] pl-10 pr-10">
      <div className="pt-6 pb-4">
        <NextLink
          href={`/dash/docs/${spaceuuid}/structure`}
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-4"
        >
          <ArrowLeft size={14} />
          Back to Structure
        </NextLink>
      </div>

      <div className="space-y-4">
        {/* Header */}
        <div className="bg-white rounded-xl nice-shadow p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <PageTypeIcon type={pageType} />
              <span className="text-xs font-medium text-gray-400 uppercase">{pageType}</span>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">Published</span>
                <Switch
                  checked={published}
                  onCheckedChange={(v) => {
                    setPublished(v)
                    markChanged()
                  }}
                />
              </div>
              <button
                onClick={handleSave}
                disabled={isSaving || !hasChanges}
                className="flex items-center gap-1.5 rounded-lg bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                <Save size={14} />
                {isSaving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>

          <div>
            <label className="text-sm font-medium text-gray-700">Page Name</label>
            <div className="flex items-center gap-2 mt-1">
              <IconPicker
                value={icon}
                onChange={(v) => {
                  setIcon(v)
                  markChanged()
                }}
              />
              <input
                type="text"
                value={name}
                onChange={(e) => {
                  setName(e.target.value)
                  markChanged()
                }}
                className="flex-1 px-3 py-2 border rounded-lg text-sm"
              />
            </div>
          </div>
        </div>

        {/* Content Editor by Type */}
      {pageType === 'LINK' && (
        <LinkEditor
          content={content}
          onChange={(c) => {
            setContent(c)
            markChanged()
          }}
        />
      )}
      {pageType === 'EMBED' && (
        <EmbedEditor
          content={content}
          onChange={(c) => {
            setContent(c)
            markChanged()
          }}
        />
      )}
      {pageType === 'COURSE_ACTIVITY' && (
        <CourseActivityEditor
          content={content}
          onChange={(c) => {
            setContent(c)
            markChanged()
          }}
          orgslug={orgslug}
          accessToken={access_token}
        />
      )}
      {pageType === 'NOCODE' && (
        <NoCodeEditor
          content={content}
          onChange={(c) => {
            setContent(c)
            markChanged()
          }}
        />
      )}
      {pageType === 'COMMUNITY' && (
        <CommunityEditor
          content={content}
          onChange={(c) => {
            setContent(c)
            markChanged()
          }}
          orgslug={orgslug}
          accessToken={access_token}
        />
      )}

      {/* Subpages sidebar */}
      {page.subpages && page.subpages.length > 0 && (
        <SubpagesSidebar subpages={page.subpages} spaceuuid={spaceuuid} />
      )}
      </div>
    </div>
  )
}

/* ─── Page Type Icon ─── */

const PageTypeIcon = ({ type }: { type: string }) => {
  switch (type) {
    case 'MARKDOWN':
      return <FileText size={16} className="text-blue-500" />
    case 'LINK':
      return <LinkIcon size={16} className="text-green-500" />
    case 'EMBED':
      return <Code size={16} className="text-purple-500" />
    case 'COURSE_ACTIVITY':
      return <Layers size={16} className="text-orange-500" />
    case 'NOCODE':
      return <Layers size={16} className="text-pink-500" />
    case 'COMMUNITY':
      return <Users size={16} className="text-indigo-500" />
    default:
      return <FileText size={16} className="text-gray-500" />
  }
}

/* ─── Link Editor ─── */

const LinkEditor = ({
  content,
  onChange,
}: {
  content: any
  onChange: (c: any) => void
}) => {
  return (
    <div className="bg-white rounded-xl nice-shadow p-6 space-y-4">
      <h3 className="text-sm font-medium text-gray-700">Link Configuration</h3>
      <div>
        <label className="text-xs font-medium text-gray-600">URL</label>
        <input
          type="url"
          value={content?.url || ''}
          onChange={(e) => onChange({ ...content, url: e.target.value })}
          className="w-full mt-1 px-3 py-2 border rounded-lg text-sm"
          placeholder="https://example.com"
        />
      </div>
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={content?.open_in_new_tab ?? true}
          onChange={(e) => onChange({ ...content, open_in_new_tab: e.target.checked })}
          className="rounded"
          id="open_new_tab"
        />
        <label htmlFor="open_new_tab" className="text-sm text-gray-600">
          Open in new tab
        </label>
      </div>
      {content?.url && (
        <a
          href={content.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800"
        >
          <ExternalLink size={14} />
          Open link
        </a>
      )}
    </div>
  )
}

/* ─── Embed Editor ─── */

const EmbedEditor = ({
  content,
  onChange,
}: {
  content: any
  onChange: (c: any) => void
}) => {
  return (
    <div className="bg-white rounded-xl nice-shadow p-6 space-y-4">
      <h3 className="text-sm font-medium text-gray-700">Embed Configuration</h3>
      <div>
        <label className="text-xs font-medium text-gray-600">Embed URL</label>
        <input
          type="url"
          value={content?.embed_url || ''}
          onChange={(e) => onChange({ ...content, embed_url: e.target.value })}
          className="w-full mt-1 px-3 py-2 border rounded-lg text-sm"
          placeholder="https://example.com/embed"
        />
      </div>
      <div>
        <label className="text-xs font-medium text-gray-600">Height (px)</label>
        <input
          type="number"
          value={content?.height || 600}
          onChange={(e) =>
            onChange({ ...content, height: parseInt(e.target.value) || 600 })
          }
          className="w-32 mt-1 px-3 py-2 border rounded-lg text-sm"
          min={200}
          max={2000}
        />
      </div>
      {content?.embed_url && (
        <div className="border rounded-lg overflow-hidden">
          <iframe
            src={content.embed_url}
            width="100%"
            height={content?.height || 600}
            className="border-0"
            title="Embed preview"
            sandbox="allow-scripts allow-same-origin allow-popups"
          />
        </div>
      )}
    </div>
  )
}

/* ─── Course Activity Editor ─── */

const ActivityTypeIcon = ({ type }: { type: string }) => {
  switch (type) {
    case 'TYPE_DYNAMIC':
      return <BookOpen size={14} className="text-blue-500" />
    case 'TYPE_VIDEO':
      return <Video size={14} className="text-red-500" />
    case 'TYPE_DOCUMENT':
      return <FileType size={14} className="text-green-500" />
    default:
      return <Layers size={14} className="text-gray-400" />
  }
}

const activityTypeLabel = (type: string) => {
  switch (type) {
    case 'TYPE_DYNAMIC': return 'Dynamic'
    case 'TYPE_VIDEO': return 'Video'
    case 'TYPE_DOCUMENT': return 'Document'
    case 'TYPE_ASSIGNMENT': return 'Assignment'
    case 'TYPE_SCORM': return 'SCORM'
    default: return type
  }
}

const CourseActivityEditor = ({
  content,
  onChange,
  orgslug,
  accessToken,
}: {
  content: any
  onChange: (c: any) => void
  orgslug: string
  accessToken: string
}) => {
  const [step, setStep] = useState<'selected' | 'courses' | 'activities'>(
    content?.activity_uuid ? 'selected' : 'courses'
  )
  const [selectedCourseUuid, setSelectedCourseUuid] = useState<string>(content?.course_uuid || '')
  const [courseSearch, setCourseSearch] = useState('')
  const [expandedChapters, setExpandedChapters] = useState<Record<number, boolean>>({})

  // Fetch org courses
  const { data: coursesData } = useSWR(
    accessToken && step === 'courses'
      ? `${getAPIUrl()}courses/org_slug/${orgslug}/page/1/limit/100?include_unpublished=true`
      : null,
    (url: string) => swrFetcher(url, accessToken),
    { revalidateOnFocus: false }
  )

  // Fetch selected course (for activity list)
  const { data: courseDetail } = useSWR(
    accessToken && selectedCourseUuid && step === 'activities'
      ? `${getAPIUrl()}courses/${selectedCourseUuid}/meta?with_unpublished_activities=true`
      : null,
    (url: string) => swrFetcher(url, accessToken),
    { revalidateOnFocus: false }
  )

  // Fetch selected activity info (for preview card)
  const { data: selectedActivity } = useSWR(
    accessToken && content?.activity_uuid && step === 'selected'
      ? `${getAPIUrl()}activities/${content.activity_uuid}`
      : null,
    (url: string) => swrFetcher(url, accessToken),
    { revalidateOnFocus: false }
  )

  // Fetch selected course name for preview
  const { data: selectedCourseInfo } = useSWR(
    accessToken && content?.course_uuid && step === 'selected'
      ? `${getAPIUrl()}courses/course_${content.course_uuid}/meta`
      : null,
    (url: string) => swrFetcher(url, accessToken),
    { revalidateOnFocus: false }
  )

  const courses = Array.isArray(coursesData) ? coursesData : []
  const filteredCourses = courses.filter((c: any) =>
    c.name?.toLowerCase().includes(courseSearch.toLowerCase())
  )

  const handleSelectCourse = (courseUuid: string) => {
    setSelectedCourseUuid(courseUuid)
    setExpandedChapters({})
    setStep('activities')
  }

  const handleSelectActivity = (activityUuid: string, courseUuid: string) => {
    onChange({ course_uuid: courseUuid, activity_uuid: activityUuid })
    setStep('selected')
  }

  const toggleChapter = (index: number) => {
    setExpandedChapters((prev) => ({ ...prev, [index]: !prev[index] }))
  }

  // Selected state — show preview card
  if (step === 'selected' && content?.activity_uuid) {
    return (
      <div className="bg-white rounded-xl nice-shadow p-6 space-y-4">
        <h3 className="text-sm font-medium text-gray-700">Course Activity Reference</h3>
        <div className="border rounded-lg p-4 bg-gray-50 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {selectedActivity && (
              <ActivityTypeIcon type={selectedActivity.activity_type} />
            )}
            <div>
              <p className="font-medium text-gray-800 text-sm">
                {selectedActivity?.name || 'Loading activity...'}
              </p>
              <div className="flex items-center gap-2 mt-0.5">
                {selectedActivity && (
                  <span className="text-xs text-gray-500 bg-gray-200 rounded px-1.5 py-0.5">
                    {activityTypeLabel(selectedActivity.activity_type)}
                  </span>
                )}
                <span className="text-xs text-gray-400">
                  {selectedCourseInfo?.name || content.course_uuid}
                </span>
              </div>
            </div>
          </div>
          <button
            onClick={() => setStep('courses')}
            className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 px-3 py-1.5 rounded-lg hover:bg-gray-100 border"
          >
            <RefreshCw size={12} />
            Change
          </button>
        </div>
      </div>
    )
  }

  // Step 1: Course selector
  if (step === 'courses') {
    return (
      <div className="bg-white rounded-xl nice-shadow p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-gray-700">Select a Course</h3>
          {content?.activity_uuid && (
            <button
              onClick={() => setStep('selected')}
              className="text-xs text-gray-500 hover:text-gray-700"
            >
              Cancel
            </button>
          )}
        </div>
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={courseSearch}
            onChange={(e) => setCourseSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 border rounded-lg text-sm"
            placeholder="Search courses..."
          />
        </div>
        <div className="max-h-[400px] overflow-y-auto space-y-1">
          {filteredCourses.length === 0 && (
            <div className="text-center text-gray-400 text-sm py-8">
              {courses.length === 0 ? 'No courses found in this organization.' : 'No courses match your search.'}
            </div>
          )}
          {filteredCourses.map((course: any) => (
            <button
              key={course.course_uuid}
              onClick={() => handleSelectCourse(course.course_uuid)}
              className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-gray-50 text-left transition-colors border border-transparent hover:border-gray-200"
            >
              <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0">
                <BookOpen size={18} className="text-gray-400" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-800 truncate">{course.name}</p>
                <p className="text-xs text-gray-400">
                  {!course.published && <span className="text-amber-500 mr-1">Draft</span>}
                </p>
              </div>
              <ChevronRight size={14} className="text-gray-300 ml-auto flex-shrink-0" />
            </button>
          ))}
        </div>
      </div>
    )
  }

  // Step 2: Activity selector
  return (
    <div className="bg-white rounded-xl nice-shadow p-6 space-y-4">
      <div className="flex items-center gap-2">
        <button
          onClick={() => setStep('courses')}
          className="text-xs text-gray-500 hover:text-gray-700"
        >
          Courses
        </button>
        <ChevronRight size={12} className="text-gray-300" />
        <h3 className="text-sm font-medium text-gray-700">
          {courseDetail?.name || 'Select an Activity'}
        </h3>
      </div>

      {!courseDetail ? (
        <div className="text-gray-400 text-sm py-8 text-center">Loading course...</div>
      ) : !courseDetail.chapters || courseDetail.chapters.length === 0 ? (
        <div className="text-gray-400 text-sm py-8 text-center">This course has no chapters or activities.</div>
      ) : (
        <div className="max-h-[400px] overflow-y-auto space-y-1">
          {courseDetail.chapters.map((chapter: any, chIdx: number) => (
            <div key={chIdx}>
              <button
                onClick={() => toggleChapter(chIdx)}
                className="w-full flex items-center gap-2 p-2 rounded-lg hover:bg-gray-50 text-left text-sm font-medium text-gray-700"
              >
                {expandedChapters[chIdx] ? (
                  <ChevronDown size={14} className="text-gray-400" />
                ) : (
                  <ChevronRight size={14} className="text-gray-400" />
                )}
                {chapter.name}
                <span className="text-xs text-gray-400 ml-auto">
                  {chapter.activities?.length || 0} activities
                </span>
              </button>
              {expandedChapters[chIdx] && chapter.activities?.map((activity: any) => {
                const isSelected = content?.activity_uuid === activity.activity_uuid
                return (
                  <button
                    key={activity.activity_uuid}
                    onClick={() => handleSelectActivity(activity.activity_uuid, selectedCourseUuid)}
                    className={`w-full flex items-center gap-3 p-2.5 pl-8 rounded-lg text-left text-sm transition-colors ${
                      isSelected
                        ? 'bg-blue-50 border border-blue-200'
                        : 'hover:bg-gray-50 border border-transparent'
                    }`}
                  >
                    <ActivityTypeIcon type={activity.activity_type} />
                    <span className="truncate text-gray-700">{activity.name}</span>
                    <span className="text-xs text-gray-400 bg-gray-100 rounded px-1.5 py-0.5 ml-auto flex-shrink-0">
                      {activityTypeLabel(activity.activity_type)}
                    </span>
                    {isSelected && <Check size={14} className="text-blue-500 flex-shrink-0" />}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ─── Subpages Sidebar ─── */

const SubpagesSidebar = ({
  subpages,
  spaceuuid,
}: {
  subpages: any[]
  spaceuuid: string
}) => {
  return (
    <div className="bg-white rounded-xl nice-shadow p-6">
      <h3 className="text-sm font-medium text-gray-700 mb-3">Subpages</h3>
      <div className="space-y-1">
        {subpages.map((sub: any) => (
          <NextLink
            key={sub.docpage_uuid}
            href={`/dash/docs/${spaceuuid}/pages/${sub.docpage_uuid}`}
            className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-50 transition-colors text-sm text-gray-600 hover:text-gray-800"
          >
            <FileText size={14} className="text-gray-400" />
            {sub.name}
          </NextLink>
        ))}
      </div>
    </div>
  )
}

/* ─── NoCode Page Builder (Placeholder) ─── */

const NoCodeEditor = ({
  content,
  onChange,
}: {
  content: any
  onChange: (c: any) => void
}) => {
  return (
    <div className="bg-white rounded-xl nice-shadow p-6">
      <div className="text-center py-12">
        <Layers size={40} className="mx-auto mb-3 text-gray-300" />
        <h3 className="text-lg font-semibold text-gray-600 mb-1">NoCode Page Builder</h3>
        <p className="text-sm text-gray-400">
          The visual page builder is coming soon. You&apos;ll be able to drag and drop
          blocks like text, images, code, and callouts to build your page.
        </p>
      </div>
    </div>
  )
}

/* ─── Community Editor ─── */

const CommunityEditor = ({
  content,
  onChange,
  orgslug,
  accessToken,
}: {
  content: any
  onChange: (c: any) => void
  orgslug: string
  accessToken: string
}) => {
  const { data: org } = useSWR(
    accessToken ? `${getAPIUrl()}orgs/slug/${orgslug}` : null,
    (url: string) => swrFetcher(url, accessToken),
    { revalidateOnFocus: false }
  )

  const { data: communities } = useSWR(
    accessToken && org?.id
      ? `${getAPIUrl()}communities/org/${org.id}/page/1/limit/100`
      : null,
    (url: string) => swrFetcher(url, accessToken),
    { revalidateOnFocus: false }
  )

  // Fetch selected community info
  const { data: selectedCommunity } = useSWR(
    accessToken && content?.community_uuid
      ? `${getAPIUrl()}communities/${content.community_uuid}`
      : null,
    (url: string) => swrFetcher(url, accessToken),
    { revalidateOnFocus: false }
  )

  const [isSelecting, setIsSelecting] = useState(!content?.community_uuid)

  const communityList = Array.isArray(communities) ? communities : []

  if (!isSelecting && content?.community_uuid) {
    return (
      <div className="bg-white rounded-xl nice-shadow p-6 space-y-4">
        <h3 className="text-sm font-medium text-gray-700">Community</h3>
        <div className="border rounded-lg p-4 bg-gray-50 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Users size={16} className="text-indigo-500" />
            <div>
              <p className="font-medium text-gray-800 text-sm">
                {selectedCommunity?.name || 'Loading community...'}
              </p>
              {selectedCommunity?.description && (
                <p className="text-xs text-gray-400 mt-0.5">
                  {selectedCommunity.description}
                </p>
              )}
            </div>
          </div>
          <button
            onClick={() => setIsSelecting(true)}
            className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 px-3 py-1.5 rounded-lg hover:bg-gray-100 border"
          >
            <RefreshCw size={12} />
            Change
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl nice-shadow p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-700">Select a Community</h3>
        {content?.community_uuid && (
          <button
            onClick={() => setIsSelecting(false)}
            className="text-xs text-gray-500 hover:text-gray-700"
          >
            Cancel
          </button>
        )}
      </div>

      <div className="max-h-[400px] overflow-y-auto space-y-1">
        {communityList.length === 0 ? (
          <div className="text-center text-gray-400 text-sm py-8">
            <MessageCircle size={28} className="mx-auto text-gray-300 mb-2" />
            <p>No communities found in this organization.</p>
          </div>
        ) : (
          communityList.map((community: any) => {
            const isSelected = content?.community_uuid === community.community_uuid
            return (
              <button
                key={community.community_uuid}
                onClick={() => {
                  onChange({ community_uuid: community.community_uuid })
                  setIsSelecting(false)
                }}
                className={`w-full flex items-center gap-3 p-3 rounded-lg text-left transition-colors border ${
                  isSelected
                    ? 'bg-indigo-50 border-indigo-200'
                    : 'border-transparent hover:bg-gray-50 hover:border-gray-200'
                }`}
              >
                <div className="w-10 h-10 rounded-lg bg-indigo-50 flex items-center justify-center flex-shrink-0">
                  <Users size={18} className="text-indigo-400" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-800 truncate">{community.name}</p>
                  {community.description && (
                    <p className="text-xs text-gray-400 truncate">{community.description}</p>
                  )}
                </div>
                {isSelected && <Check size={14} className="text-indigo-500 flex-shrink-0" />}
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}

export default DocPageEditor
