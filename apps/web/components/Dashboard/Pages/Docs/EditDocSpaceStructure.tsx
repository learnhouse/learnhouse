'use client'

import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { useDocSpace } from '@components/Contexts/DocSpaceContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import {
  Plus,
  FileText,
  Trash2,
  GripVertical,
  Layers,
  FilePenLine,
  X,
  MoreHorizontal,
  Save,
  Pencil,
  Loader2,
  FolderOpen,
  Link2,
  BookOpen,
  Search,
  ChevronRight,
  ChevronDown,
  Video,
  FileType,
  Check,
  Users,
  ArrowRightLeft,
} from 'lucide-react'
import { swrFetcher } from '@services/utils/ts/requests'
import { createDocSection, deleteDocSection, updateDocSection, reorderSectionChildren } from '@services/docs/docsections'
import { createDocGroup, deleteDocGroup, updateDocGroup } from '@services/docs/docgroups'
import {
  createDocPageInSection,
  createDocPageInGroup,
  deleteDocPage,
  updateDocPage,
  moveDocPage,
  reorderDocPages,
  createSubpage,
} from '@services/docs/docpages'
import { getAPIUrl } from '@services/config/config'
import useSWR, { mutate } from 'swr'
import toast from 'react-hot-toast'
import Link from 'next/link'
import IconPicker from '@components/Objects/Docs/IconPicker'
import PhosphorIconRenderer from '@components/Objects/Docs/PhosphorIconRenderer'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import ConfirmationModal from '@components/Objects/StyledElements/ConfirmationModal/ConfirmationModal'
import {
  DragDropContext,
  Droppable,
  Draggable,
  DropResult,
} from '@hello-pangea/dnd'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@components/ui/dropdown-menu'

interface EditDocSpaceStructureProps {
  spaceuuid: string
  orgId: number
  orgslug: string
}

// A unified child item — either an ungrouped page or a group
type SectionChild =
  | { _type: 'page'; order: number; [key: string]: any }
  | { _type: 'group'; order: number; pages: any[]; [key: string]: any }

/* ─── Forms ─── */

function NewSectionForm({
  onCreated,
  spaceuuid,
  accessToken,
}: {
  onCreated: () => void
  spaceuuid: string
  accessToken: string
}) {
  const [name, setName] = useState('')
  const [icon, setIcon] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setIsCreating(true)
    try {
      const data: any = { name, published: true }
      if (icon) data.icon = icon
      await createDocSection(spaceuuid, data, accessToken)
      toast.success('Section created')
      setName('')
      setIcon(null)
      onCreated()
    } catch {
      toast.error('Failed to create section')
    } finally {
      setIsCreating(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 p-1">
      <div>
        <label className="text-sm font-medium text-gray-700">Section Name</label>
        <div className="flex items-center gap-2 mt-1">
          <IconPicker value={icon} onChange={setIcon} />
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="flex-1 px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-black focus:ring-offset-1"
            placeholder="e.g., Getting Started"
            autoFocus
            required
          />
        </div>
      </div>
      <div className="flex justify-end">
        <button
          type="submit"
          disabled={!name.trim() || isCreating}
          className="rounded-lg bg-black px-5 py-2 text-sm font-medium text-white disabled:opacity-50 hover:bg-gray-800 transition-colors flex items-center gap-2"
        >
          {isCreating && <Loader2 size={14} className="animate-spin" />}
          Create
        </button>
      </div>
    </form>
  )
}

function NewGroupForm({
  onCreated,
  docsectionUuid,
  accessToken,
}: {
  onCreated: () => void
  docsectionUuid: string
  accessToken: string
}) {
  const [name, setName] = useState('')
  const [icon, setIcon] = useState<string | null>(null)
  const [groupType, setGroupType] = useState<'STANDARD' | 'API_REFERENCE'>('STANDARD')
  const [isCreating, setIsCreating] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setIsCreating(true)
    try {
      const data: any = { name, group_type: groupType }
      if (icon) data.icon = icon
      await createDocGroup(docsectionUuid, data, accessToken)
      toast.success('Group created')
      setName('')
      setIcon(null)
      setGroupType('STANDARD')
      onCreated()
    } catch {
      toast.error('Failed to create group')
    } finally {
      setIsCreating(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 p-1">
      <div>
        <label className="text-sm font-medium text-gray-700">Group Type</label>
        <div className="grid grid-cols-2 gap-2 mt-1.5">
          <button
            type="button"
            onClick={() => setGroupType('STANDARD')}
            className={`flex flex-col items-center gap-1.5 p-3 rounded-lg border-2 transition-all text-center ${
              groupType === 'STANDARD'
                ? 'border-black bg-gray-50'
                : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
            }`}
          >
            <FolderOpen size={20} className={groupType === 'STANDARD' ? 'text-gray-900' : 'text-gray-400'} />
            <span className={`text-xs font-semibold ${groupType === 'STANDARD' ? 'text-gray-900' : 'text-gray-500'}`}>
              Standard
            </span>
          </button>
          <button
            type="button"
            onClick={() => setGroupType('API_REFERENCE')}
            className={`flex flex-col items-center gap-1.5 p-3 rounded-lg border-2 transition-all text-center ${
              groupType === 'API_REFERENCE'
                ? 'border-black bg-gray-50'
                : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
            }`}
          >
            <Layers size={20} className={groupType === 'API_REFERENCE' ? 'text-gray-900' : 'text-gray-400'} />
            <span className={`text-xs font-semibold ${groupType === 'API_REFERENCE' ? 'text-gray-900' : 'text-gray-500'}`}>
              API Reference
            </span>
          </button>
        </div>
        <p className="text-xs text-gray-400 mt-1.5">
          {groupType === 'STANDARD'
            ? 'A standard group for organizing documentation pages.'
            : 'An API reference group with endpoint pages and interactive playground.'}
        </p>
      </div>
      <div>
        <label className="text-sm font-medium text-gray-700">Group Name</label>
        <div className="flex items-center gap-2 mt-1">
          <IconPicker value={icon} onChange={setIcon} />
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="flex-1 px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-black focus:ring-offset-1"
            placeholder={groupType === 'API_REFERENCE' ? 'e.g., Users API' : 'e.g., Core concepts'}
            autoFocus
            required
          />
        </div>
      </div>
      <div className="flex justify-end">
        <button
          type="submit"
          disabled={!name.trim() || isCreating}
          className="rounded-lg bg-black px-5 py-2 text-sm font-medium text-white disabled:opacity-50 hover:bg-gray-800 transition-colors flex items-center gap-2"
        >
          {isCreating && <Loader2 size={14} className="animate-spin" />}
          Create
        </button>
      </div>
    </form>
  )
}

const PAGE_TYPES = [
  { value: 'MARKDOWN', label: 'Page', description: 'A rich text page you can edit', icon: FileText },
  { value: 'LINK', label: 'Link', description: 'An external URL', icon: Link2 },
  { value: 'COURSE_ACTIVITY', label: 'Course Activity', description: 'An activity from a course', icon: BookOpen },
  { value: 'COMMUNITY', label: 'Community', description: 'Discussions from a community', icon: Users },
] as const

/* ─── Inline Activity Picker for NewPageForm ─── */

const activityTypeLabelInline = (type: string) => {
  switch (type) {
    case 'TYPE_DYNAMIC': return 'Dynamic'
    case 'TYPE_VIDEO': return 'Video'
    case 'TYPE_DOCUMENT': return 'Document'
    case 'TYPE_ASSIGNMENT': return 'Assignment'
    case 'TYPE_SCORM': return 'SCORM'
    default: return type
  }
}

const ActivityTypeIconInline = ({ type }: { type: string }) => {
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

function InlineActivityPicker({
  orgslug,
  accessToken,
  selectedActivity,
  onSelect,
}: {
  orgslug: string
  accessToken: string
  selectedActivity: { course_uuid: string; activity_uuid: string } | null
  onSelect: (content: { course_uuid: string; activity_uuid: string }, activityName: string) => void
}) {
  const [pickerStep, setPickerStep] = useState<'courses' | 'activities'>(
    selectedActivity ? 'courses' : 'courses'
  )
  const [selectedCourseUuid, setSelectedCourseUuid] = useState('')
  const [courseSearch, setCourseSearch] = useState('')
  const [expandedChapters, setExpandedChapters] = useState<Record<number, boolean>>({})

  const { data: coursesData } = useSWR(
    accessToken && orgslug
      ? `${getAPIUrl()}courses/org_slug/${orgslug}/page/1/limit/100?include_unpublished=true`
      : null,
    (url: string) => swrFetcher(url, accessToken),
    { revalidateOnFocus: false }
  )

  const { data: courseDetail } = useSWR(
    accessToken && selectedCourseUuid && pickerStep === 'activities'
      ? `${getAPIUrl()}courses/${selectedCourseUuid}/meta?with_unpublished_activities=true`
      : null,
    (url: string) => swrFetcher(url, accessToken),
    { revalidateOnFocus: false }
  )

  // Fetch selected activity info for display
  const { data: selectedActivityInfo } = useSWR(
    accessToken && selectedActivity?.activity_uuid
      ? `${getAPIUrl()}activities/${selectedActivity.activity_uuid}`
      : null,
    (url: string) => swrFetcher(url, accessToken),
    { revalidateOnFocus: false }
  )

  const courses = Array.isArray(coursesData) ? coursesData : []
  const filteredCourses = courses.filter((c: any) =>
    c.name?.toLowerCase().includes(courseSearch.toLowerCase())
  )

  const toggleChapter = (index: number) => {
    setExpandedChapters((prev) => ({ ...prev, [index]: !prev[index] }))
  }

  // If an activity is already selected, show a compact card
  if (selectedActivity && selectedActivityInfo) {
    return (
      <div className="border rounded-lg p-3 bg-gray-50 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ActivityTypeIconInline type={selectedActivityInfo.activity_type} />
          <div>
            <p className="text-sm font-medium text-gray-800">{selectedActivityInfo.name}</p>
            <span className="text-xs text-gray-400">
              {activityTypeLabelInline(selectedActivityInfo.activity_type)}
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            setPickerStep('courses')
            setSelectedCourseUuid('')
          }}
          className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1 rounded hover:bg-gray-100"
        >
          Change
        </button>
      </div>
    )
  }

  // Course list
  if (pickerStep === 'courses') {
    return (
      <div className="space-y-2">
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
        <div className="max-h-[250px] overflow-y-auto space-y-0.5 border rounded-lg">
          {filteredCourses.length === 0 && (
            <div className="text-center text-gray-400 text-xs py-6">
              {courses.length === 0 ? 'No courses found.' : 'No courses match your search.'}
            </div>
          )}
          {filteredCourses.map((course: any) => (
            <button
              key={course.course_uuid}
              type="button"
              onClick={() => {
                setSelectedCourseUuid(course.course_uuid)
                setExpandedChapters({})
                setPickerStep('activities')
              }}
              className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-50 text-left text-sm transition-colors"
            >
              <BookOpen size={14} className="text-gray-400 flex-shrink-0" />
              <span className="truncate text-gray-700">{course.name}</span>
              {!course.published && <span className="text-xs text-amber-500 flex-shrink-0">Draft</span>}
              <ChevronRight size={12} className="text-gray-300 ml-auto flex-shrink-0" />
            </button>
          ))}
        </div>
      </div>
    )
  }

  // Activity list
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-xs text-gray-500">
        <button type="button" onClick={() => setPickerStep('courses')} className="hover:text-gray-700">
          Courses
        </button>
        <ChevronRight size={10} className="text-gray-300" />
        <span className="font-medium text-gray-700 truncate">{courseDetail?.name || 'Loading...'}</span>
      </div>
      <div className="max-h-[250px] overflow-y-auto border rounded-lg">
        {!courseDetail ? (
          <div className="text-gray-400 text-xs py-6 text-center">Loading...</div>
        ) : !courseDetail.chapters || courseDetail.chapters.length === 0 ? (
          <div className="text-gray-400 text-xs py-6 text-center">No chapters or activities.</div>
        ) : (
          courseDetail.chapters.map((chapter: any, chIdx: number) => (
            <div key={chIdx}>
              <button
                type="button"
                onClick={() => toggleChapter(chIdx)}
                className="w-full flex items-center gap-1.5 px-3 py-2 hover:bg-gray-50 text-left text-sm font-medium text-gray-700"
              >
                {expandedChapters[chIdx] ? (
                  <ChevronDown size={12} className="text-gray-400" />
                ) : (
                  <ChevronRight size={12} className="text-gray-400" />
                )}
                {chapter.name}
                <span className="text-xs text-gray-400 font-normal ml-auto">
                  {chapter.activities?.length || 0}
                </span>
              </button>
              {expandedChapters[chIdx] && chapter.activities?.map((activity: any) => (
                <button
                  key={activity.activity_uuid}
                  type="button"
                  onClick={() => {
                    onSelect(
                      { course_uuid: selectedCourseUuid, activity_uuid: activity.activity_uuid },
                      activity.name
                    )
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 pl-7 hover:bg-blue-50 text-left text-sm transition-colors"
                >
                  <ActivityTypeIconInline type={activity.activity_type} />
                  <span className="truncate text-gray-700">{activity.name}</span>
                  <span className="text-xs text-gray-400 bg-gray-100 rounded px-1.5 py-0.5 ml-auto flex-shrink-0">
                    {activityTypeLabelInline(activity.activity_type)}
                  </span>
                </button>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

/* ─── Inline Community Picker ─── */

function InlineCommunityPicker({
  orgslug,
  accessToken,
  selectedCommunityUuid,
  onSelect,
}: {
  orgslug: string
  accessToken: string
  selectedCommunityUuid: string | null
  onSelect: (communityUuid: string, communityName: string) => void
}) {
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

  // Fetch selected community info for display
  const { data: selectedCommunity } = useSWR(
    accessToken && selectedCommunityUuid
      ? `${getAPIUrl()}communities/${selectedCommunityUuid}`
      : null,
    (url: string) => swrFetcher(url, accessToken),
    { revalidateOnFocus: false }
  )

  const [showList, setShowList] = useState(!selectedCommunityUuid)
  const communityList = Array.isArray(communities) ? communities : []

  // If a community is selected, show a compact card
  if (selectedCommunityUuid && selectedCommunity && !showList) {
    return (
      <div className="border rounded-lg p-3 bg-gray-50 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users size={14} className="text-indigo-500" />
          <div>
            <p className="text-sm font-medium text-gray-800">{selectedCommunity.name}</p>
            {selectedCommunity.description && (
              <span className="text-xs text-gray-400">{selectedCommunity.description}</span>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setShowList(true)}
          className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1 rounded hover:bg-gray-100"
        >
          Change
        </button>
      </div>
    )
  }

  return (
    <div className="max-h-[250px] overflow-y-auto space-y-0.5 border rounded-lg">
      {communityList.length === 0 ? (
        <div className="text-center text-gray-400 text-xs py-6">
          No communities found in this organization.
        </div>
      ) : (
        communityList.map((community: any) => {
          const isSelected = selectedCommunityUuid === community.community_uuid
          return (
            <button
              key={community.community_uuid}
              type="button"
              onClick={() => {
                onSelect(community.community_uuid, community.name)
                setShowList(false)
              }}
              className={`w-full flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                isSelected ? 'bg-indigo-50' : 'hover:bg-gray-50'
              }`}
            >
              <Users size={14} className="text-indigo-400 flex-shrink-0" />
              <div className="min-w-0 flex-1">
                <span className="truncate text-gray-700 block">{community.name}</span>
                {community.description && (
                  <span className="text-xs text-gray-400 truncate block">{community.description}</span>
                )}
              </div>
              {isSelected && <Check size={14} className="text-indigo-500 flex-shrink-0" />}
            </button>
          )
        })
      )}
    </div>
  )
}

/* ─── New Page Form ─── */

function NewPageForm({
  onCreated,
  parentUuid,
  parentType,
  accessToken,
  orgslug,
}: {
  onCreated: () => void
  parentUuid: string
  parentType: 'section' | 'group'
  accessToken: string
  orgslug: string
}) {
  const [name, setName] = useState('')
  const [pageType, setPageType] = useState<string>('MARKDOWN')
  const [icon, setIcon] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)

  // LINK content
  const [linkUrl, setLinkUrl] = useState('')
  const [openInNewTab, setOpenInNewTab] = useState(true)

  // COURSE_ACTIVITY content
  const [activityContent, setActivityContent] = useState<{ course_uuid: string; activity_uuid: string } | null>(null)

  // COMMUNITY content
  const [communityUuid, setCommunityUuid] = useState<string | null>(null)

  const resetForm = useCallback(() => {
    setName('')
    setPageType('MARKDOWN')
    setIcon(null)
    setLinkUrl('')
    setOpenInNewTab(true)
    setActivityContent(null)
    setCommunityUuid(null)
  }, [])

  const isValid = () => {
    if (!name.trim()) return false
    if (pageType === 'LINK' && !linkUrl.trim()) return false
    if (pageType === 'COURSE_ACTIVITY' && !activityContent) return false
    if (pageType === 'COMMUNITY' && !communityUuid) return false
    return true
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!isValid()) return
    setIsCreating(true)
    try {
      let content: any = undefined
      if (pageType === 'LINK') {
        content = { url: linkUrl, open_in_new_tab: openInNewTab }
      } else if (pageType === 'COURSE_ACTIVITY' && activityContent) {
        content = activityContent
      } else if (pageType === 'COMMUNITY' && communityUuid) {
        content = { community_uuid: communityUuid }
      }
      const data: any = { name, page_type: pageType, published: true }
      if (icon) data.icon = icon
      if (content) data.content = content
      if (parentType === 'section') {
        await createDocPageInSection(parentUuid, data, accessToken)
      } else {
        await createDocPageInGroup(parentUuid, data, accessToken)
      }
      toast.success('Page created')
      resetForm()
      onCreated()
    } catch {
      toast.error('Failed to create page')
    } finally {
      setIsCreating(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 p-1">
      {/* Page type selector */}
      <div>
        <label className="text-sm font-medium text-gray-700">Page Type</label>
        <div className="grid grid-cols-4 gap-2 mt-1.5">
          {PAGE_TYPES.map((pt) => {
            const Icon = pt.icon
            const isSelected = pageType === pt.value
            return (
              <button
                key={pt.value}
                type="button"
                onClick={() => {
                  setPageType(pt.value)
                  setActivityContent(null)
                  setLinkUrl('')
                  setCommunityUuid(null)
                }}
                className={`flex flex-col items-center gap-1.5 p-3 rounded-lg border-2 transition-all text-center ${
                  isSelected
                    ? 'border-black bg-gray-50'
                    : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                }`}
              >
                <Icon size={20} className={isSelected ? 'text-gray-900' : 'text-gray-400'} />
                <span className={`text-xs font-semibold ${isSelected ? 'text-gray-900' : 'text-gray-500'}`}>
                  {pt.label}
                </span>
              </button>
            )
          })}
        </div>
        <p className="text-xs text-gray-400 mt-1.5">
          {pageType === 'MARKDOWN'
            ? 'A rich text page you can edit with a block editor.'
            : pageType === 'LINK'
            ? 'An external URL that opens when clicked.'
            : pageType === 'COMMUNITY'
            ? 'Show discussions from a community.'
            : 'Embed an activity from one of your courses.'}
        </p>
      </div>

      {/* Name + Icon */}
      <div>
        <label className="text-sm font-medium text-gray-700">Page Name</label>
        <div className="flex items-center gap-2 mt-1">
          <IconPicker value={icon} onChange={setIcon} />
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="flex-1 px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-black focus:ring-offset-1"
            placeholder="e.g., Introduction"
            autoFocus
            required
          />
        </div>
      </div>

      {/* LINK — URL input */}
      {pageType === 'LINK' && (
        <div>
          <label className="text-sm font-medium text-gray-700">Link URL</label>
          <input
            type="url"
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            className="w-full mt-1 px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-black focus:ring-offset-1"
            placeholder="https://example.com"
            required
          />
          <label className="flex items-center gap-2 cursor-pointer mt-2">
            <input
              type="checkbox"
              checked={openInNewTab}
              onChange={(e) => setOpenInNewTab(e.target.checked)}
              className="rounded border-gray-300"
            />
            <span className="text-xs text-gray-500">Open in new tab</span>
          </label>
        </div>
      )}

      {/* COURSE_ACTIVITY — Activity picker */}
      {pageType === 'COURSE_ACTIVITY' && (
        <div>
          <label className="text-sm font-medium text-gray-700">Select Activity</label>
          <div className="mt-1">
            <InlineActivityPicker
              orgslug={orgslug}
              accessToken={accessToken}
              selectedActivity={activityContent}
              onSelect={(content, activityName) => {
                setActivityContent(content)
                if (!name.trim()) setName(activityName)
              }}
            />
          </div>
        </div>
      )}

      {/* COMMUNITY — Community picker */}
      {pageType === 'COMMUNITY' && (
        <div>
          <label className="text-sm font-medium text-gray-700">Select Community</label>
          <div className="mt-1">
            <InlineCommunityPicker
              orgslug={orgslug}
              accessToken={accessToken}
              selectedCommunityUuid={communityUuid}
              onSelect={(uuid, communityName) => {
                setCommunityUuid(uuid)
                if (!name.trim()) setName(communityName)
              }}
            />
          </div>
        </div>
      )}

      {/* Submit */}
      <div className="flex justify-end">
        <button
          type="submit"
          disabled={!isValid() || isCreating}
          className="rounded-lg bg-black px-5 py-2 text-sm font-medium text-white disabled:opacity-50 hover:bg-gray-800 transition-colors flex items-center gap-2"
        >
          {isCreating && <Loader2 size={14} className="animate-spin" />}
          Create
        </button>
      </div>
    </form>
  )
}

/* ─── OpenAPI Config Form (API Reference groups) ─── */

function OpenApiConfigForm({
  onSaved,
  docgroupUuid,
  currentConfig,
  accessToken,
}: {
  onSaved: () => void
  docgroupUuid: string
  currentConfig: any
  accessToken: string
}) {
  const [sourceType, setSourceType] = useState<'upload' | 'url'>(
    currentConfig?.source_url ? 'url' : 'upload'
  )
  const [specUrl, setSpecUrl] = useState(currentConfig?.source_url || '')
  const [specJson, setSpecJson] = useState(
    currentConfig?.spec ? JSON.stringify(currentConfig.spec, null, 2) : ''
  )
  const [excludedPaths, setExcludedPaths] = useState<string[]>(currentConfig?.excluded_paths || [])
  const [excludedTags, setExcludedTags] = useState<string[]>(currentConfig?.excluded_tags || [])
  const [isSaving, setIsSaving] = useState(false)
  const [isFetching, setIsFetching] = useState(false)
  const [parseError, setParseError] = useState<string | null>(null)
  const [parsedSpec, setParsedSpec] = useState<any>(currentConfig?.spec || null)

  const handleFetchUrl = async () => {
    if (!specUrl.trim()) return
    setIsFetching(true)
    setParseError(null)
    try {
      const res = await fetch(specUrl)
      const text = await res.text()
      const parsed = JSON.parse(text)
      setParsedSpec(parsed)
      setSpecJson(JSON.stringify(parsed, null, 2))
    } catch {
      setParseError('Failed to fetch or parse the OpenAPI spec from the URL.')
    } finally {
      setIsFetching(false)
    }
  }

  const handleParseJson = () => {
    setParseError(null)
    try {
      const parsed = JSON.parse(specJson)
      setParsedSpec(parsed)
    } catch {
      setParseError('Invalid JSON. Please check your OpenAPI spec.')
    }
  }

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const text = ev.target?.result as string
        const parsed = JSON.parse(text)
        setParsedSpec(parsed)
        setSpecJson(JSON.stringify(parsed, null, 2))
        setParseError(null)
      } catch {
        setParseError('Failed to parse uploaded file as JSON.')
      }
    }
    reader.readAsText(file)
  }

  // Extract all tags and paths from parsed spec for exclusion UI
  const allTags = useMemo(() => {
    if (!parsedSpec?.paths) return []
    const tags = new Set<string>()
    for (const pathItem of Object.values(parsedSpec.paths as Record<string, any>)) {
      for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
        const op = (pathItem as any)[method]
        if (op?.tags) op.tags.forEach((t: string) => tags.add(t))
      }
    }
    return Array.from(tags).sort()
  }, [parsedSpec])

  const allPaths = useMemo(() => {
    if (!parsedSpec?.paths) return []
    return Object.keys(parsedSpec.paths).sort()
  }, [parsedSpec])

  const handleSave = async () => {
    if (!parsedSpec) {
      setParseError('No valid spec loaded. Please upload or fetch a spec first.')
      return
    }
    setIsSaving(true)
    try {
      await updateDocGroup(
        docgroupUuid,
        {
          api_config: {
            spec: parsedSpec,
            source_url: sourceType === 'url' ? specUrl : null,
            excluded_paths: excludedPaths,
            excluded_tags: excludedTags,
          },
        },
        accessToken
      )
      toast.success('API spec saved')
      onSaved()
    } catch {
      toast.error('Failed to save API spec')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="space-y-4 p-1">
      {/* Source type selector */}
      <div>
        <label className="text-sm font-medium text-gray-700 block mb-1.5">Source</label>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setSourceType('upload')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              sourceType === 'upload' ? 'bg-black text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
            }`}
          >
            Upload JSON
          </button>
          <button
            type="button"
            onClick={() => setSourceType('url')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              sourceType === 'url' ? 'bg-black text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
            }`}
          >
            From URL
          </button>
        </div>
      </div>

      {/* URL input */}
      {sourceType === 'url' && (
        <div>
          <label className="text-xs font-medium text-gray-600">OpenAPI Spec URL</label>
          <div className="flex items-center gap-2 mt-1">
            <input
              type="url"
              value={specUrl}
              onChange={(e) => setSpecUrl(e.target.value)}
              className="flex-1 px-3 py-2 border rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-black focus:ring-offset-1"
              placeholder="https://api.example.com/openapi.json"
            />
            <button
              type="button"
              onClick={handleFetchUrl}
              disabled={!specUrl.trim() || isFetching}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 disabled:opacity-50 flex items-center gap-1.5"
            >
              {isFetching && <Loader2 size={14} className="animate-spin" />}
              Fetch
            </button>
          </div>
        </div>
      )}

      {/* File upload */}
      {sourceType === 'upload' && (
        <div>
          <label className="text-xs font-medium text-gray-600 block mb-1">Upload OpenAPI JSON file</label>
          <input
            type="file"
            accept=".json,application/json"
            onChange={handleFileUpload}
            className="text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-gray-100 file:text-gray-700 hover:file:bg-gray-200"
          />
          <div className="mt-2">
            <label className="text-xs font-medium text-gray-600 block mb-1">Or paste JSON directly</label>
            <textarea
              value={specJson}
              onChange={(e) => setSpecJson(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg text-xs font-mono resize-y bg-gray-50"
              rows={6}
              placeholder='{"openapi": "3.0.0", ...}'
            />
            <button
              type="button"
              onClick={handleParseJson}
              disabled={!specJson.trim()}
              className="mt-1 px-3 py-1.5 text-xs font-medium text-gray-600 hover:text-gray-800 bg-gray-100 rounded-lg hover:bg-gray-200 disabled:opacity-50"
            >
              Parse JSON
            </button>
          </div>
        </div>
      )}

      {/* Parse error */}
      {parseError && (
        <div className="p-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-600">
          {parseError}
        </div>
      )}

      {/* Spec preview */}
      {parsedSpec && (
        <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
          <p className="text-xs font-medium text-green-700">
            Spec loaded: {parsedSpec.info?.title || 'Untitled'} {parsedSpec.info?.version || ''}
          </p>
          <p className="text-xs text-green-600 mt-0.5">
            {allPaths.length} paths, {allTags.length} tags
          </p>
        </div>
      )}

      {/* Exclusion UI */}
      {parsedSpec && (allTags.length > 0 || allPaths.length > 0) && (
        <div className="space-y-3">
          <label className="text-sm font-medium text-gray-700 block">Exclude endpoints</label>

          {/* Exclude by tags */}
          {allTags.length > 0 && (
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Exclude tags</label>
              <div className="flex flex-wrap gap-1.5">
                {allTags.map((tag) => {
                  const isExcluded = excludedTags.includes(tag)
                  return (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => {
                        setExcludedTags(
                          isExcluded
                            ? excludedTags.filter((t) => t !== tag)
                            : [...excludedTags, tag]
                        )
                      }}
                      className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                        isExcluded
                          ? 'bg-red-100 text-red-600 border border-red-200 line-through'
                          : 'bg-gray-100 text-gray-600 border border-gray-200 hover:bg-gray-200'
                      }`}
                    >
                      {tag}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Exclude by paths */}
          {allPaths.length > 0 && (
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Exclude paths</label>
              <div className="max-h-[200px] overflow-y-auto border rounded-lg">
                {allPaths.map((path) => {
                  const isExcluded = excludedPaths.includes(path)
                  return (
                    <button
                      key={path}
                      type="button"
                      onClick={() => {
                        setExcludedPaths(
                          isExcluded
                            ? excludedPaths.filter((p) => p !== path)
                            : [...excludedPaths, path]
                        )
                      }}
                      className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs font-mono transition-colors border-b last:border-b-0 ${
                        isExcluded
                          ? 'bg-red-50 text-red-500 line-through'
                          : 'hover:bg-gray-50 text-gray-700'
                      }`}
                    >
                      {path}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Save */}
      <div className="flex justify-end pt-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={!parsedSpec || isSaving}
          className="rounded-lg bg-black px-5 py-2 text-sm font-medium text-white disabled:opacity-50 hover:bg-gray-800 transition-colors flex items-center gap-2"
        >
          {isSaving && <Loader2 size={14} className="animate-spin" />}
          Save API Spec
        </button>
      </div>
    </div>
  )
}

/* ─── New Subpage Form ─── */

function NewSubpageForm({
  onCreated,
  parentPageUuid,
  accessToken,
}: {
  onCreated: () => void
  parentPageUuid: string
  accessToken: string
}) {
  const [name, setName] = useState('')
  const [isCreating, setIsCreating] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setIsCreating(true)
    try {
      await createSubpage(parentPageUuid, { name, published: true }, accessToken)
      toast.success('Subpage created')
      setName('')
      onCreated()
    } catch {
      toast.error('Failed to create subpage')
    } finally {
      setIsCreating(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 p-1">
      <div>
        <label className="text-sm font-medium text-gray-700">Subpage Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full mt-1 px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-black focus:ring-offset-1"
          placeholder="e.g., Parameters"
          autoFocus
          required
        />
      </div>
      <div className="flex justify-end">
        <button
          type="submit"
          disabled={!name.trim() || isCreating}
          className="rounded-lg bg-black px-5 py-2 text-sm font-medium text-white disabled:opacity-50 hover:bg-gray-800 transition-colors flex items-center gap-2"
        >
          {isCreating && <Loader2 size={14} className="animate-spin" />}
          Create
        </button>
      </div>
    </form>
  )
}

/* ─── Main Component ─── */

const EditDocSpaceStructure = ({
  spaceuuid,
  orgId,
  orgslug,
}: EditDocSpaceStructureProps) => {
  const { docSpaceStructure, isLoading } = useDocSpace()
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token

  const [activeSectionUuid, setActiveSectionUuid] = useState<string | null>(null)
  const [newSectionModalOpen, setNewSectionModalOpen] = useState(false)
  const [newGroupModalSection, setNewGroupModalSection] = useState<string | null>(null)
  const [newPageModalParent, setNewPageModalParent] = useState<{
    uuid: string
    type: 'section' | 'group'
  } | null>(null)

  const sections = docSpaceStructure?.sections || []

  useEffect(() => {
    if (sections.length > 0 && !activeSectionUuid) {
      setActiveSectionUuid(sections[0].docsection_uuid)
    }
  }, [sections, activeSectionUuid])

  const activeSection = sections.find(
    (s: any) => s.docsection_uuid === activeSectionUuid
  )

  // Merge ungrouped pages and groups into one sorted list
  const sectionChildren: SectionChild[] = useMemo(() => {
    if (!activeSection) return []
    const pages = (activeSection.pages || []).map((p: any) => ({ ...p, _type: 'page' as const }))
    const groups = (activeSection.groups || []).map((g: any) => ({ ...g, _type: 'group' as const }))
    return [...pages, ...groups].sort((a, b) => a.order - b.order)
  }, [activeSection])

  const swrKey = `${getAPIUrl()}docs/${spaceuuid}/meta`

  const revalidate = () => {
    mutate(swrKey)
  }

  // ─── Optimistic Helpers ───

  const optimisticReorderSectionChildren = useCallback(
    (newChildren: SectionChild[]) => {
      if (!docSpaceStructure) return null
      return {
        ...docSpaceStructure,
        sections: docSpaceStructure.sections.map((s: any) => {
          if (s.docsection_uuid !== activeSectionUuid) return s
          const newPages: any[] = []
          const newGroups: any[] = []
          newChildren.forEach((child, idx) => {
            if (child._type === 'page') {
              const { _type, ...pageData } = child as any
              newPages.push({ ...pageData, order: idx })
            } else {
              const { _type, ...groupData } = child as any
              newGroups.push({ ...groupData, order: idx })
            }
          })
          return { ...s, pages: newPages, groups: newGroups }
        }),
      }
    },
    [docSpaceStructure, activeSectionUuid]
  )

  const optimisticReorderGroupPages = useCallback(
    (groupUuid: string, newPages: any[]) => {
      if (!docSpaceStructure) return null
      return {
        ...docSpaceStructure,
        sections: docSpaceStructure.sections.map((s: any) => {
          if (s.docsection_uuid !== activeSectionUuid) return s
          return {
            ...s,
            groups: (s.groups || []).map((g: any) => {
              if (g.docgroup_uuid !== groupUuid) return g
              return {
                ...g,
                pages: newPages.map((p: any, i: number) => ({ ...p, order: i })),
              }
            }),
          }
        }),
      }
    },
    [docSpaceStructure, activeSectionUuid]
  )

  const optimisticMovePage = useCallback(
    (pageUuid: string, targetGroupUuid: string | null) => {
      if (!docSpaceStructure) return null
      return {
        ...docSpaceStructure,
        sections: docSpaceStructure.sections.map((s: any) => {
          if (s.docsection_uuid !== activeSectionUuid) return s

          let movedPage: any = null
          let newPages = [...(s.pages || [])]
          let newGroups = (s.groups || []).map((g: any) => ({
            ...g,
            pages: [...(g.pages || [])],
          }))

          // Find and remove page from its current location
          const sectionPageIdx = newPages.findIndex(
            (p: any) => p.docpage_uuid === pageUuid
          )
          if (sectionPageIdx >= 0) {
            movedPage = { ...newPages[sectionPageIdx] }
            newPages.splice(sectionPageIdx, 1)
          } else {
            for (const group of newGroups) {
              const gPageIdx = group.pages.findIndex(
                (p: any) => p.docpage_uuid === pageUuid
              )
              if (gPageIdx >= 0) {
                movedPage = { ...group.pages[gPageIdx] }
                group.pages.splice(gPageIdx, 1)
                break
              }
            }
          }

          if (!movedPage) return s

          if (targetGroupUuid) {
            // Move into a group
            const targetGroup = newGroups.find(
              (g: any) => g.docgroup_uuid === targetGroupUuid
            )
            if (targetGroup) {
              const maxOrder =
                targetGroup.pages.length > 0
                  ? Math.max(...targetGroup.pages.map((p: any) => p.order)) + 1
                  : 0
              targetGroup.pages.push({ ...movedPage, order: maxOrder })
            }
          } else {
            // Move to section level (ungroup)
            const allOrders = [
              ...newPages.map((p: any) => p.order),
              ...newGroups.map((g: any) => g.order),
            ]
            const nextOrder =
              allOrders.length > 0 ? Math.max(...allOrders) + 1 : 0
            newPages.push({ ...movedPage, order: nextOrder })
          }

          return { ...s, pages: newPages, groups: newGroups }
        }),
      }
    },
    [docSpaceStructure, activeSectionUuid]
  )

  // ─── Move Handlers ───

  const handleMoveToGroup = useCallback(
    async (pageUuid: string, targetGroupUuid: string) => {
      const optimistic = optimisticMovePage(pageUuid, targetGroupUuid)
      if (optimistic) mutate(swrKey, optimistic, { revalidate: false })

      try {
        await moveDocPage(
          pageUuid,
          { docgroup_uuid: targetGroupUuid },
          access_token
        )
        mutate(swrKey)
      } catch {
        mutate(swrKey)
        toast.error('Failed to move page')
      }
    },
    [optimisticMovePage, access_token, swrKey]
  )

  const handleUngroupPage = useCallback(
    async (pageUuid: string) => {
      const optimistic = optimisticMovePage(pageUuid, null)
      if (optimistic) mutate(swrKey, optimistic, { revalidate: false })

      try {
        await moveDocPage(pageUuid, { docgroup_uuid: null }, access_token)
        mutate(swrKey)
      } catch {
        mutate(swrKey)
        toast.error('Failed to ungroup page')
      }
    },
    [optimisticMovePage, access_token, swrKey]
  )

  const handleRenameSection = async (uuid: string, newName: string) => {
    try {
      await updateDocSection(uuid, { name: newName }, access_token)
      toast.success('Section renamed')
      revalidate()
    } catch {
      toast.error('Failed to rename section')
    }
  }

  const handleUpdateSectionIcon = async (uuid: string, icon: string | null) => {
    try {
      await updateDocSection(uuid, { icon } as any, access_token)
      revalidate()
    } catch {
      toast.error('Failed to update icon')
    }
  }

  const handleDeleteSection = async (uuid: string) => {
    try {
      await deleteDocSection(uuid, access_token)
      toast.success('Section deleted')
      if (activeSectionUuid === uuid) setActiveSectionUuid(null)
      revalidate()
    } catch {
      toast.error('Failed to delete section')
    }
  }

  const handleDeleteGroup = async (uuid: string) => {
    try {
      await deleteDocGroup(uuid, access_token)
      toast.success('Group deleted')
      revalidate()
    } catch {
      toast.error('Failed to delete group')
    }
  }

  const handleDeletePage = async (uuid: string) => {
    try {
      await deleteDocPage(uuid, access_token)
      toast.success('Page deleted')
      revalidate()
    } catch {
      toast.error('Failed to delete page')
    }
  }

  const handleRenamePage = async (uuid: string, newName: string) => {
    try {
      await updateDocPage(uuid, { name: newName }, access_token)
      toast.success('Page renamed')
      revalidate()
    } catch {
      toast.error('Failed to rename page')
    }
  }

  const handleUpdatePageIcon = async (uuid: string, icon: string | null) => {
    try {
      await updateDocPage(uuid, { icon } as any, access_token)
      revalidate()
    } catch {
      toast.error('Failed to update icon')
    }
  }

  const handleUpdateGroupIcon = async (uuid: string, icon: string | null) => {
    try {
      await updateDocGroup(uuid, { icon } as any, access_token)
      revalidate()
    } catch {
      toast.error('Failed to update icon')
    }
  }

  /* ─── Drag and drop ─── */

  // Track whether a page (not a group) is being dragged — used to expand group drop zones
  const [draggingPageId, setDraggingPageId] = useState<string | null>(null)

  const handleDragStart = useCallback((start: any) => {
    const id = start.draggableId as string
    if (!id.startsWith('group-')) {
      setDraggingPageId(id)
    }
  }, [])

  const handleDragEnd = async (result: DropResult) => {
    setDraggingPageId(null)
    const { source, destination, draggableId } = result
    if (!destination) return
    if (source.droppableId === destination.droppableId && source.index === destination.index) return
    if (!activeSection) return

    const srcId = source.droppableId
    const dstId = destination.droppableId
    const isGroupDrag = draggableId.startsWith('group-')

    // ── Case 1: Reorder at section level (pages + groups unified) ──
    if (srcId === 'section-children' && dstId === 'section-children') {
      const newChildren = [...sectionChildren]
      const [moved] = newChildren.splice(source.index, 1)
      newChildren.splice(destination.index, 0, moved)

      const optimistic = optimisticReorderSectionChildren(newChildren)
      if (optimistic) mutate(swrKey, optimistic, { revalidate: false })

      const orderPayload = newChildren.map((child) => ({
        type: child._type,
        id: child.id,
      }))

      try {
        await reorderSectionChildren(activeSection.docsection_uuid, orderPayload, access_token)
        mutate(swrKey)
      } catch {
        mutate(swrKey)
        toast.error('Failed to reorder')
      }
      return
    }

    // ── Case 2: Reorder within same group ──
    if (srcId === dstId && srcId.startsWith('group-pages-')) {
      const groupUuid = srcId.replace('group-pages-', '')
      const group = activeSection.groups?.find((g: any) => g.docgroup_uuid === groupUuid)
      if (!group) return
      const pages = [...(group.pages || [])]
      const [moved] = pages.splice(source.index, 1)
      pages.splice(destination.index, 0, moved)

      const optimistic = optimisticReorderGroupPages(groupUuid, pages)
      if (optimistic) mutate(swrKey, optimistic, { revalidate: false })

      const ids = pages.map((p: any) => p.id)
      try {
        await reorderDocPages(activeSection.docsection_uuid, ids, access_token)
        mutate(swrKey)
      } catch {
        mutate(swrKey)
        toast.error('Failed to reorder pages')
      }
      return
    }

    // ── Case 3: Move page from section level INTO a group ──
    if (srcId === 'section-children' && dstId.startsWith('group-pages-')) {
      if (isGroupDrag) return // groups can't be dropped into other groups
      const child = sectionChildren[source.index]
      if (!child || child._type !== 'page') return

      const targetGroupUuid = dstId.replace('group-pages-', '')

      // Optimistic: remove from section, add to group
      const optimistic = optimisticMovePage(child.docpage_uuid, targetGroupUuid)
      if (optimistic) mutate(swrKey, optimistic, { revalidate: false })

      try {
        await moveDocPage(
          child.docpage_uuid,
          { docgroup_uuid: targetGroupUuid, order: destination.index },
          access_token
        )
        mutate(swrKey)
      } catch {
        mutate(swrKey)
        toast.error('Failed to move page into group')
      }
      return
    }

    // ── Case 4: Move page from group TO section level (ungroup) ──
    if (srcId.startsWith('group-pages-') && dstId === 'section-children') {
      const srcGroupUuid = srcId.replace('group-pages-', '')
      const srcGroup = activeSection.groups?.find((g: any) => g.docgroup_uuid === srcGroupUuid)
      if (!srcGroup) return
      const movedPage = srcGroup.pages?.[source.index]
      if (!movedPage) return

      // Build the new section children list with the page inserted at the right position
      const newChildren = [...sectionChildren]
      newChildren.splice(destination.index, 0, { ...movedPage, _type: 'page' as const })

      // Optimistic: remove from group + insert into section children with correct orders
      if (docSpaceStructure) {
        const optimistic = {
          ...docSpaceStructure,
          sections: docSpaceStructure.sections.map((s: any) => {
            if (s.docsection_uuid !== activeSectionUuid) return s
            // Remove page from source group
            const newGroups = (s.groups || []).map((g: any) => {
              if (g.docgroup_uuid !== srcGroupUuid) return g
              return { ...g, pages: (g.pages || []).filter((p: any) => p.docpage_uuid !== movedPage.docpage_uuid) }
            })
            // Build new pages and group orders from the merged list
            const newPages: any[] = []
            const updatedGroups = newGroups.map((g: any) => ({ ...g }))
            newChildren.forEach((child, idx) => {
              if (child._type === 'page') {
                newPages.push({ ...(child as any), order: idx, _type: undefined })
              } else {
                const grp = updatedGroups.find((g: any) => g.docgroup_uuid === (child as any).docgroup_uuid)
                if (grp) grp.order = idx
              }
            })
            // Clean _type from pages
            const cleanPages = newPages.map(({ _type, ...rest }: any) => rest)
            return { ...s, pages: cleanPages, groups: updatedGroups }
          }),
        }
        mutate(swrKey, optimistic, { revalidate: false })
      }

      try {
        // First ungroup the page
        await moveDocPage(movedPage.docpage_uuid, { docgroup_uuid: null }, access_token)
        // Then set the correct unified order
        const orderPayload = newChildren.map((child) => ({
          type: child._type,
          id: child.id,
        }))
        await reorderSectionChildren(activeSection.docsection_uuid, orderPayload, access_token)
        mutate(swrKey)
      } catch {
        mutate(swrKey)
        toast.error('Failed to ungroup page')
      }
      return
    }

    // ── Case 5: Move page between groups ──
    if (srcId.startsWith('group-pages-') && dstId.startsWith('group-pages-')) {
      const srcGroupUuid = srcId.replace('group-pages-', '')
      const srcGroup = activeSection.groups?.find((g: any) => g.docgroup_uuid === srcGroupUuid)
      if (!srcGroup) return
      const movedPage = srcGroup.pages?.[source.index]
      if (!movedPage) return

      const dstGroupUuid = dstId.replace('group-pages-', '')

      const optimistic = optimisticMovePage(movedPage.docpage_uuid, dstGroupUuid)
      if (optimistic) mutate(swrKey, optimistic, { revalidate: false })

      try {
        await moveDocPage(
          movedPage.docpage_uuid,
          { docgroup_uuid: dstGroupUuid, order: destination.index },
          access_token
        )
        mutate(swrKey)
      } catch {
        mutate(swrKey)
        toast.error('Failed to move page')
      }
      return
    }
  }

  if (isLoading || !docSpaceStructure) {
    return (
      <div className="h-full flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
      </div>
    )
  }

  return (
    <div className="flex flex-col">
      <div className="h-6" />

      {/* Section selector */}
      <div className="flex items-center gap-2 flex-wrap mx-2 sm:mx-4 md:mx-6 lg:mx-10 mb-4">
        {sections.map((section: any) => (
          <SectionTab
            key={section.docsection_uuid}
            section={section}
            isActive={section.docsection_uuid === activeSectionUuid}
            onSelect={() => setActiveSectionUuid(section.docsection_uuid)}
            onDelete={() => handleDeleteSection(section.docsection_uuid)}
            onRename={(newName) => handleRenameSection(section.docsection_uuid, newName)}
            onUpdateIcon={(icon) => handleUpdateSectionIcon(section.docsection_uuid, icon)}
          />
        ))}

        <Modal
          isDialogOpen={newSectionModalOpen}
          onOpenChange={setNewSectionModalOpen}
          minHeight="no-min"
          dialogTitle="New Section"
          dialogDescription="Add a new section to organize your documentation."
          dialogContent={
            <NewSectionForm
              spaceuuid={spaceuuid}
              accessToken={access_token}
              onCreated={() => { setNewSectionModalOpen(false); revalidate() }}
            />
          }
          dialogTrigger={
            <button className="px-4 py-2 text-sm font-medium text-gray-400 hover:text-gray-600 rounded-lg border-2 border-dashed border-gray-200 hover:border-gray-300 transition-all flex items-center gap-1.5">
              <Plus size={14} /> Section
            </button>
          }
        />
      </div>

      {/* Active section content */}
      {activeSection ? (
        <DragDropContext onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          {/* Add page / Add group buttons */}
          <div className="mx-2 sm:mx-4 md:mx-6 lg:mx-10 pb-3 pt-2 flex items-center gap-3">
            <Modal
              isDialogOpen={
                newPageModalParent?.uuid === activeSection.docsection_uuid &&
                newPageModalParent?.type === 'section'
              }
              onOpenChange={(open) =>
                setNewPageModalParent(
                  open ? { uuid: activeSection.docsection_uuid, type: 'section' } : null
                )
              }
              minHeight="no-min"
              minWidth="sm"
              dialogTitle="New Page"
              dialogDescription="Add a new page to this section."
              dialogContent={
                <NewPageForm
                  parentUuid={activeSection.docsection_uuid}
                  parentType="section"
                  accessToken={access_token}
                  orgslug={orgslug}
                  onCreated={() => { setNewPageModalParent(null); revalidate() }}
                />
              }
              dialogTrigger={
                <button className="flex-1 py-3 px-3 rounded-lg border-2 border-dashed border-gray-200 hover:border-gray-300 transition-all flex items-center justify-center gap-2">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-gray-500">
                    <Plus size={12} /> Add Page
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-[9px] font-semibold text-blue-600 bg-blue-50 border border-blue-200 px-1.5 py-0 rounded-full">Markdown</span>
                    <span className="text-[9px] font-semibold text-emerald-600 bg-emerald-50 border border-emerald-200 px-1.5 py-0 rounded-full">Link</span>
                    <span className="text-[9px] font-semibold text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0 rounded-full">Activity</span>
                    <span className="text-[9px] font-semibold text-indigo-600 bg-indigo-50 border border-indigo-200 px-1.5 py-0 rounded-full">Community</span>
                  </div>
                </button>
              }
            />
            <Modal
              isDialogOpen={newGroupModalSection === activeSection.docsection_uuid}
              onOpenChange={(open) =>
                setNewGroupModalSection(open ? activeSection.docsection_uuid : null)
              }
              minHeight="no-min"
              dialogTitle="New Group"
              dialogDescription="Add a group to organize pages within this section."
              dialogContent={
                <NewGroupForm
                  docsectionUuid={activeSection.docsection_uuid}
                  accessToken={access_token}
                  onCreated={() => { setNewGroupModalSection(null); revalidate() }}
                />
              }
              dialogTrigger={
                <button className="flex-1 py-3 px-3 rounded-lg border-2 border-dashed border-gray-200 hover:border-gray-300 transition-all flex items-center justify-center gap-2">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-gray-500">
                    <FolderOpen size={12} /> Add Group
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-[9px] font-semibold text-gray-600 bg-gray-100 border border-gray-200 px-1.5 py-0 rounded-full">Standard</span>
                    <span className="text-[9px] font-semibold text-purple-600 bg-purple-50 border border-purple-200 px-1.5 py-0 rounded-full">API Reference</span>
                  </div>
                </button>
              }
            />
          </div>

          {/* Unified section children — pages and groups interleaved, all type="item" */}
          <Droppable droppableId="section-children" type="item">
            {(provided, snapshot) => (
              <div
                ref={provided.innerRef}
                {...provided.droppableProps}
                className={`space-y-2 mx-2 sm:mx-4 md:mx-6 lg:mx-10 rounded-xl transition-all ${
                  snapshot.isDraggingOver
                    ? 'bg-blue-50/50 ring-2 ring-dashed ring-blue-200 p-3 min-h-[60px]'
                    : sectionChildren.length > 0
                    ? 'min-h-[20px] pb-2'
                    : 'min-h-[8px]'
                }`}
              >
                {sectionChildren.map((child, index: number) => {
                  if (child._type === 'page') {
                    return (
                      <Draggable
                        key={child.docpage_uuid}
                        draggableId={child.docpage_uuid}
                        index={index}
                      >
                        {(provided, snapshot) => (
                          <div
                            ref={provided.innerRef}
                            {...provided.draggableProps}
                            style={provided.draggableProps.style}
                          >
                            <PageItem
                              page={child}
                              spaceuuid={spaceuuid}
                              onDelete={handleDeletePage}
                              onRename={handleRenamePage}
                              onUpdateIcon={handleUpdatePageIcon}
                              dragHandleProps={provided.dragHandleProps}
                              isDragging={snapshot.isDragging}
                              accessToken={access_token}
                              revalidate={revalidate}
                              sectionGroups={activeSection.groups || []}
                              currentGroupUuid={null}
                              onMoveToGroup={handleMoveToGroup}
                              onUngroupPage={handleUngroupPage}
                            />
                          </div>
                        )}
                      </Draggable>
                    )
                  } else {
                    // _type === 'group'
                    return (
                      <Draggable
                        key={`group-${child.docgroup_uuid}`}
                        draggableId={`group-${child.docgroup_uuid}`}
                        index={index}
                      >
                        {(provided, snapshot) => (
                          <div
                            ref={provided.innerRef}
                            {...provided.draggableProps}
                            style={provided.draggableProps.style}
                          >
                            <GroupCard
                              group={child}
                              section={activeSection}
                              spaceuuid={spaceuuid}
                              orgslug={orgslug}
                              onDeleteGroup={handleDeleteGroup}
                              onDeletePage={handleDeletePage}
                              onRenamePage={handleRenamePage}
                              onUpdatePageIcon={handleUpdatePageIcon}
                              onUpdateGroupIcon={handleUpdateGroupIcon}
                              newPageModalParent={newPageModalParent}
                              setNewPageModalParent={setNewPageModalParent}
                              accessToken={access_token}
                              revalidate={revalidate}
                              dragHandleProps={provided.dragHandleProps}
                              isDragging={snapshot.isDragging}
                              sectionGroups={activeSection.groups || []}
                              onMoveToGroup={handleMoveToGroup}
                              onUngroupPage={handleUngroupPage}
                              isPageDragActive={!!draggingPageId}
                            />
                          </div>
                        )}
                      </Draggable>
                    )
                  }
                })}
                {provided.placeholder}
              </div>
            )}
          </Droppable>

        </DragDropContext>
      ) : (
        <div className="flex items-center justify-center py-20">
          <div className="text-center">
            <div className="bg-gray-100 rounded-2xl p-5 w-fit mx-auto mb-4">
              <Layers size={32} className="text-gray-400" />
            </div>
            <p className="text-sm font-semibold text-gray-500">No sections yet</p>
            <p className="text-xs text-gray-400 mt-1">
              Create your first section to start building documentation.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

/* ─── Section Tab (renamable) ─── */

const SectionTab = ({
  section,
  isActive,
  onSelect,
  onDelete,
  onRename,
  onUpdateIcon,
}: {
  section: any
  isActive: boolean
  onSelect: () => void
  onDelete: () => void
  onRename: (newName: string) => void
  onUpdateIcon: (icon: string | null) => void
}) => {
  const [isRenaming, setIsRenaming] = useState(false)
  const [name, setName] = useState(section.name)

  const handleSubmitRename = () => {
    const trimmed = name.trim()
    if (trimmed && trimmed !== section.name) {
      onRename(trimmed)
    } else {
      setName(section.name)
    }
    setIsRenaming(false)
  }

  return (
    <div className="relative group flex items-center">
      {isRenaming ? (
        <div className="flex items-center gap-1.5 bg-white nice-shadow rounded-lg px-2 py-1">
          <IconPicker
            value={section.icon || null}
            onChange={(iconName) => onUpdateIcon(iconName)}
          />
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="bg-transparent outline-none text-sm font-semibold text-gray-700 w-32"
            autoFocus
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter') handleSubmitRename()
              if (e.key === 'Escape') { setName(section.name); setIsRenaming(false) }
            }}
            onBlur={handleSubmitRename}
          />
          <button onClick={handleSubmitRename} className="text-gray-400 hover:text-gray-600">
            <Save size={13} />
          </button>
        </div>
      ) : (
        <div
          onClick={onSelect}
          onDoubleClick={() => setIsRenaming(true)}
          className={`px-3 py-2 text-sm font-semibold rounded-lg transition-all flex items-center gap-1.5 cursor-pointer ${
            isActive
              ? 'bg-black text-white shadow-sm'
              : 'bg-white text-gray-500 hover:text-gray-700 nice-shadow hover:bg-gray-50'
          }`}
        >
          <div onClick={(e) => e.stopPropagation()}>
            <IconPicker
              value={section.icon || null}
              onChange={(iconName) => onUpdateIcon(iconName)}
              compact
            />
          </div>
          {section.name}
        </div>
      )}

      {!isRenaming && (
        <div className="opacity-0 group-hover:opacity-100 transition-opacity absolute -top-1 -right-1 flex items-center gap-0.5">
          <button
            onClick={() => setIsRenaming(true)}
            className="h-4 w-4 rounded-full bg-gray-500 text-white flex items-center justify-center hover:bg-gray-600 transition-colors shadow-sm"
          >
            <Pencil size={8} />
          </button>
          <ConfirmationModal
            confirmationButtonText="Delete"
            confirmationMessage="Delete this section and all its contents? This action cannot be undone."
            dialogTitle="Delete Section"
            dialogTrigger={
              <button className="h-4 w-4 rounded-full bg-red-500 text-white flex items-center justify-center hover:bg-red-600 transition-colors shadow-sm">
                <X size={10} />
              </button>
            }
            functionToExecute={onDelete}
            status="warning"
          />
        </div>
      )}
    </div>
  )
}

/* ─── Group Card ─── */

const GroupCard = ({
  group,
  section,
  spaceuuid,
  orgslug,
  onDeleteGroup,
  onDeletePage,
  onRenamePage,
  onUpdatePageIcon,
  onUpdateGroupIcon,
  newPageModalParent,
  setNewPageModalParent,
  accessToken,
  revalidate,
  dragHandleProps,
  isDragging,
  sectionGroups,
  onMoveToGroup,
  onUngroupPage,
  isPageDragActive,
}: {
  group: any
  section: any
  spaceuuid: string
  orgslug: string
  onDeleteGroup: (uuid: string) => void
  onDeletePage: (uuid: string) => void
  onRenamePage: (uuid: string, newName: string) => void
  onUpdatePageIcon: (uuid: string, icon: string | null) => void
  onUpdateGroupIcon: (uuid: string, icon: string | null) => void
  newPageModalParent: { uuid: string; type: 'section' | 'group' } | null
  setNewPageModalParent: (parent: { uuid: string; type: 'section' | 'group' } | null) => void
  accessToken: string
  revalidate: () => void
  dragHandleProps: any
  isDragging: boolean
  sectionGroups: any[]
  onMoveToGroup: (pageUuid: string, targetGroupUuid: string) => void
  onUngroupPage: (pageUuid: string) => void
  isPageDragActive?: boolean
}) => {
  const [isRenaming, setIsRenaming] = useState(false)
  const [newName, setNewName] = useState(group.name)

  const handleRenameGroup = async () => {
    const trimmed = newName.trim()
    if (trimmed && trimmed !== group.name) {
      try {
        await updateDocGroup(group.docgroup_uuid, { name: trimmed }, accessToken)
        toast.success('Group renamed')
        revalidate()
      } catch {
        toast.error('Failed to rename group')
      }
    } else {
      setNewName(group.name)
    }
    setIsRenaming(false)
  }

  return (
    <div
      className={`bg-white rounded-xl nice-shadow px-3 sm:px-4 md:px-6 pt-5 ${
        isDragging ? 'shadow-xl ring-2 ring-blue-500/20 rotate-1' : ''
      }`}
    >
      {/* Group header */}
      <div className="flex items-center justify-between pb-3">
        <div className="flex items-center gap-2.5 flex-1 min-w-0">
          <div
            {...dragHandleProps}
            className="cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-400 transition-colors flex-shrink-0"
          >
            <GripVertical size={18} />
          </div>
          <IconPicker
            value={group.icon || null}
            onChange={(iconName) => onUpdateGroupIcon(group.docgroup_uuid, iconName)}
          />
          {isRenaming ? (
            <div className="flex items-center gap-2 bg-neutral-100 py-1 px-3 rounded-lg flex-1 min-w-0">
              <input
                type="text"
                className="bg-transparent outline-none text-sm text-neutral-700 flex-1 min-w-0"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                autoFocus
                onKeyDown={(e) => {
                  e.stopPropagation()
                  if (e.key === 'Enter') handleRenameGroup()
                  if (e.key === 'Escape') { setIsRenaming(false); setNewName(group.name) }
                }}
                onBlur={handleRenameGroup}
              />
              <button
                onClick={handleRenameGroup}
                className="text-neutral-500 hover:text-neutral-700 flex-shrink-0"
              >
                <Save size={14} />
              </button>
            </div>
          ) : (
            <>
              <span className="text-sm font-semibold text-neutral-700 truncate">{group.name}</span>
              {group.group_type === 'API_REFERENCE' && (
                <span className="text-[10px] font-bold text-purple-600 bg-purple-50 border border-purple-200 px-1.5 py-0.5 rounded flex-shrink-0">
                  API Reference
                </span>
              )}
            </>
          )}
          {!isRenaming && (
            <button onClick={() => setIsRenaming(true)} className="text-gray-300 hover:text-gray-400 flex-shrink-0">
              <Pencil size={13} />
            </button>
          )}
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
          <ConfirmationModal
            confirmationButtonText="Delete"
            confirmationMessage="Delete this group and all its pages?"
            dialogTitle="Delete Group"
            dialogTrigger={
              <button className="h-7 px-2 bg-red-50 text-red-600 hover:bg-red-100 rounded-md flex items-center transition-colors border border-red-200 shadow-sm shadow-red-300/20">
                <Trash2 size={12} />
              </button>
            }
            functionToExecute={() => onDeleteGroup(group.docgroup_uuid)}
            status="warning"
          />
        </div>
      </div>

      {/* Group pages — type="item" matches section-children for cross-container dragging */}
      <Droppable droppableId={`group-pages-${group.docgroup_uuid}`} type="item">
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            className={`rounded-lg transition-all space-y-2 ${
              snapshot.isDraggingOver
                ? 'bg-blue-50/60 p-3 ring-2 ring-blue-300/60 ring-dashed min-h-[80px]'
                : isPageDragActive
                ? 'bg-gray-50/80 p-3 ring-2 ring-dashed ring-gray-200 min-h-[80px]'
                : 'min-h-[40px]'
            }`}
          >
            {isPageDragActive && !snapshot.isDraggingOver && (!group.pages || group.pages.length === 0) && (
              <div className="flex items-center justify-center py-3 text-xs text-gray-400 pointer-events-none">
                Drop page here
              </div>
            )}
            {group.pages?.map((page: any, index: number) => (
              <Draggable
                key={page.docpage_uuid}
                draggableId={page.docpage_uuid}
                index={index}
              >
                {(provided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.draggableProps}
                    style={provided.draggableProps.style}
                  >
                    <PageItem
                      page={page}
                      spaceuuid={spaceuuid}
                      onDelete={onDeletePage}
                      onRename={onRenamePage}
                      onUpdateIcon={onUpdatePageIcon}
                      dragHandleProps={provided.dragHandleProps}
                      isDragging={snapshot.isDragging}
                      accessToken={accessToken}
                      revalidate={revalidate}
                      sectionGroups={sectionGroups}
                      currentGroupUuid={group.docgroup_uuid}
                      onMoveToGroup={onMoveToGroup}
                      onUngroupPage={onUngroupPage}
                    />
                  </div>
                )}
              </Draggable>
            ))}
            {provided.placeholder}
          </div>
        )}
      </Droppable>

      {/* Add page to group + API config for API_REFERENCE */}
      <div className="py-3 flex items-center gap-3">
        <Modal
          isDialogOpen={
            newPageModalParent?.uuid === group.docgroup_uuid &&
            newPageModalParent?.type === 'group'
          }
          onOpenChange={(open) =>
            setNewPageModalParent(open ? { uuid: group.docgroup_uuid, type: 'group' } : null)
          }
          minHeight="no-min"
          minWidth="sm"
          dialogTitle="New Page"
          dialogDescription="Add a new page to this group."
          dialogContent={
            <NewPageForm
              parentUuid={group.docgroup_uuid}
              parentType="group"
              accessToken={accessToken}
              orgslug={orgslug}
              onCreated={() => { setNewPageModalParent(null); revalidate() }}
            />
          }
          dialogTrigger={
            <button className="flex items-center gap-1.5 text-xs font-medium text-gray-400 hover:text-gray-600 transition-colors">
              <Plus size={12} /> Add Page
            </button>
          }
        />
        {group.group_type === 'API_REFERENCE' && (
          <OpenApiConfigButton
            group={group}
            accessToken={accessToken}
            revalidate={revalidate}
          />
        )}
      </div>

      <div className="h-5 flex items-center justify-center">
        <MoreHorizontal size={16} className="text-gray-200" />
      </div>
    </div>
  )
}

/* ─── OpenAPI Config Button ─── */

const OpenApiConfigButton = ({
  group,
  accessToken,
  revalidate,
}: {
  group: any
  accessToken: string
  revalidate: () => void
}) => {
  const [isOpen, setIsOpen] = useState(false)
  const hasSpec = !!group.api_config?.spec

  return (
    <Modal
      isDialogOpen={isOpen}
      onOpenChange={setIsOpen}
      minHeight="no-min"
      minWidth="md"
      dialogTitle="API Reference Configuration"
      dialogDescription="Upload an OpenAPI spec or provide a URL. You can exclude specific endpoints or tag groups."
      dialogContent={
        <OpenApiConfigForm
          docgroupUuid={group.docgroup_uuid}
          currentConfig={group.api_config}
          accessToken={accessToken}
          onSaved={() => { setIsOpen(false); revalidate() }}
        />
      }
      dialogTrigger={
        <button className={`flex items-center gap-1.5 text-xs font-medium transition-colors ${
          hasSpec ? 'text-green-600 hover:text-green-700' : 'text-purple-500 hover:text-purple-700'
        }`}>
          <Layers size={12} />
          {hasSpec ? 'Edit API Spec' : 'Configure API Spec'}
        </button>
      }
    />
  )
}

/* ─── Page Item ─── */

const PageItem = ({
  page,
  spaceuuid,
  onDelete,
  onRename,
  onUpdateIcon,
  dragHandleProps,
  isDragging,
  accessToken,
  revalidate,
  sectionGroups,
  currentGroupUuid,
  onMoveToGroup,
  onUngroupPage,
}: {
  page: any
  spaceuuid: string
  onDelete: (uuid: string) => void
  onRename: (uuid: string, newName: string) => void
  onUpdateIcon: (uuid: string, icon: string | null) => void
  dragHandleProps: any
  isDragging: boolean
  accessToken?: string
  revalidate?: () => void
  sectionGroups?: any[]
  currentGroupUuid?: string | null
  onMoveToGroup?: (pageUuid: string, targetGroupUuid: string) => void
  onUngroupPage?: (pageUuid: string) => void
}) => {
  const [isRenaming, setIsRenaming] = useState(false)
  const [name, setName] = useState(page.name)
  const [expanded, setExpanded] = useState(false)
  const [subpageModalOpen, setSubpageModalOpen] = useState(false)

  const pageTypeLabel = page.page_type === 'LINK' ? 'Link' : page.page_type === 'COURSE_ACTIVITY' ? 'Activity' : page.page_type === 'EMBED' ? 'Embed' : page.page_type === 'COMMUNITY' ? 'Community' : 'Page'
  const subpages = page.subpages || []
  const hasSubpages = subpages.length > 0
  const isTopLevel = !page.parent_page_id

  const handleSubmitRename = () => {
    const trimmed = name.trim()
    if (trimmed && trimmed !== page.name) {
      onRename(page.docpage_uuid, trimmed)
    } else {
      setName(page.name)
    }
    setIsRenaming(false)
  }

  return (
    <div>
      <div
        className={`flex items-center gap-3 py-2.5 px-3 w-full rounded-lg text-gray-500 ${
          isDragging
            ? 'nice-shadow bg-white ring-2 ring-blue-500/20 rotate-1 scale-[1.02]'
            : 'nice-shadow bg-white hover:bg-gray-50'
        }`}
      >
        <div
          {...dragHandleProps}
          className="flex-shrink-0 cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-400 transition-colors"
        >
          <GripVertical size={18} />
        </div>

        {/* Expand/collapse for pages with subpages */}
        {isTopLevel && (hasSubpages || page.page_type !== 'LINK') && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex-shrink-0 text-gray-300 hover:text-gray-500 transition-colors"
          >
            {hasSubpages ? (
              expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />
            ) : (
              <span className="w-[14px]" />
            )}
          </button>
        )}

        <div className="flex items-center gap-1.5 flex-shrink-0">
          <IconPicker
            value={page.icon || null}
            onChange={(iconName) => onUpdateIcon(page.docpage_uuid, iconName)}
          />
          <span className="text-xs font-medium text-gray-400 hidden sm:inline">{pageTypeLabel}</span>
        </div>

        <div className="flex-1 min-w-0">
          {isRenaming ? (
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-gray-50 outline-none text-sm text-gray-700 px-2 py-0.5 rounded border border-gray-200 focus:ring-2 focus:ring-black focus:ring-offset-1"
              autoFocus
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter') handleSubmitRename()
                if (e.key === 'Escape') { setName(page.name); setIsRenaming(false) }
              }}
              onBlur={handleSubmitRename}
            />
          ) : (
            <div className="flex items-center gap-2">
              <p
                className="first-letter:uppercase text-sm text-gray-600 truncate cursor-pointer"
                onDoubleClick={() => setIsRenaming(true)}
              >
                {page.name}
              </p>
              {hasSubpages && (
                <span className="text-[10px] text-gray-400 bg-gray-100 rounded px-1.5 py-0.5 flex-shrink-0">
                  {subpages.length} sub
                </span>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          {!isRenaming && (
            <button
              onClick={() => setIsRenaming(true)}
              className="h-7 px-1.5 text-gray-300 hover:text-gray-500 rounded-md flex items-center transition-colors"
            >
              <Pencil size={12} />
            </button>
          )}
          {/* Move to group / Ungroup dropdown */}
          {sectionGroups && sectionGroups.length > 0 && onMoveToGroup && onUngroupPage && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="h-7 px-1.5 text-gray-300 hover:text-gray-500 rounded-md flex items-center transition-colors">
                  <ArrowRightLeft size={13} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuLabel className="text-xs text-gray-400">Move page</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {currentGroupUuid && (
                  <>
                    <DropdownMenuItem
                      onClick={() => onUngroupPage(page.docpage_uuid)}
                      className="text-xs gap-2"
                    >
                      <FolderOpen size={12} className="text-gray-400" />
                      Remove from group
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                {sectionGroups
                  .filter((g: any) => g.docgroup_uuid !== currentGroupUuid)
                  .map((g: any) => (
                    <DropdownMenuItem
                      key={g.docgroup_uuid}
                      onClick={() => onMoveToGroup(page.docpage_uuid, g.docgroup_uuid)}
                      className="text-xs gap-2"
                    >
                      <FolderOpen size={12} className="text-gray-400" />
                      <span className="truncate">{g.name}</span>
                    </DropdownMenuItem>
                  ))}
                {sectionGroups.filter((g: any) => g.docgroup_uuid !== currentGroupUuid).length === 0 &&
                  !currentGroupUuid && (
                    <div className="px-2 py-2 text-xs text-gray-400">
                      No groups available
                    </div>
                  )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <Link
            href={`/dash/docs/${spaceuuid}/pages/${page.docpage_uuid}`}
            className="h-7 px-2 bg-blue-50 text-blue-600 hover:bg-blue-100 rounded-md flex items-center gap-1 text-xs font-bold transition-colors border border-blue-200 shadow-sm shadow-blue-300/20"
          >
            <FilePenLine size={12} />
            <span className="hidden sm:inline">Edit</span>
          </Link>
          <ConfirmationModal
            confirmationButtonText="Delete"
            confirmationMessage="Delete this page? This action cannot be undone."
            dialogTitle="Delete Page"
            dialogTrigger={
              <button className="h-7 px-2 bg-red-50 text-red-600 hover:bg-red-100 rounded-md flex items-center transition-colors border border-red-200 shadow-sm shadow-red-300/20">
                <Trash2 size={12} />
              </button>
            }
            functionToExecute={() => onDelete(page.docpage_uuid)}
            status="warning"
          />
        </div>
      </div>

      {/* Subpages (expanded) */}
      {expanded && isTopLevel && (
        <div className="ml-8 mt-1 space-y-1 border-l-2 border-gray-100 pl-3">
          {subpages.map((sub: any) => (
            <div
              key={sub.docpage_uuid}
              className="flex items-center gap-2 py-2 px-3 rounded-lg bg-gray-50 hover:bg-gray-100 transition-colors"
            >
              <PhosphorIconRenderer
                iconName={sub.icon}
                size={14}
                className="text-gray-400 flex-shrink-0"
              />
              <span className="text-sm text-gray-600 truncate flex-1">{sub.name}</span>
              <Link
                href={`/dash/docs/${spaceuuid}/pages/${sub.docpage_uuid}`}
                className="h-6 px-2 bg-blue-50 text-blue-600 hover:bg-blue-100 rounded-md flex items-center gap-1 text-xs font-bold transition-colors border border-blue-200"
              >
                <FilePenLine size={10} />
              </Link>
              <ConfirmationModal
                confirmationButtonText="Delete"
                confirmationMessage="Delete this subpage?"
                dialogTitle="Delete Subpage"
                dialogTrigger={
                  <button className="h-6 px-1.5 bg-red-50 text-red-500 hover:bg-red-100 rounded-md flex items-center transition-colors border border-red-200">
                    <Trash2 size={10} />
                  </button>
                }
                functionToExecute={() => onDelete(sub.docpage_uuid)}
                status="warning"
              />
            </div>
          ))}
          {/* Add subpage button */}
          {accessToken && revalidate && (
            <Modal
              isDialogOpen={subpageModalOpen}
              onOpenChange={setSubpageModalOpen}
              minHeight="no-min"
              dialogTitle="New Subpage"
              dialogDescription={`Add a subpage under "${page.name}".`}
              dialogContent={
                <NewSubpageForm
                  parentPageUuid={page.docpage_uuid}
                  accessToken={accessToken}
                  onCreated={() => { setSubpageModalOpen(false); revalidate() }}
                />
              }
              dialogTrigger={
                <button className="flex items-center gap-1 text-xs font-medium text-gray-400 hover:text-gray-600 transition-colors py-1">
                  <Plus size={10} /> Add Subpage
                </button>
              }
            />
          )}
        </div>
      )}
    </div>
  )
}

export default EditDocSpaceStructure
