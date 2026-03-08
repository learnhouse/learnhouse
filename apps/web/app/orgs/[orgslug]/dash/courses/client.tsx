'use client'
import { Breadcrumbs } from '@components/Objects/Breadcrumbs/Breadcrumbs'
import CreateCourseModal from '@components/Objects/Modals/Course/Create/CreateCourse'
import CourseCreationTypeSelector from '@components/Objects/Modals/Course/Create/CourseCreationTypeSelector'
import AICourseCreationModal from '@components/Objects/Modals/Course/Create/AICourse/AICourseCreationModal'
import { BookCopy, Search, X, Trash2, ChevronLeft, ChevronRight, Upload, Users, Info } from 'lucide-react'
import ScormCourseImport from '../../../../../ee/components/Modals/ScormCourseImport'
import { ImportTypeSelector, LearnHouseCourseImport } from '@components/Objects/Modals/Course/Import'
import CourseThumbnail, { removeCoursePrefix } from '@components/Objects/Thumbnails/CourseThumbnail'
import AuthenticatedClientElement from '@components/Security/AuthenticatedClientElement'
import NewCourseButton from '@components/Objects/StyledElements/Buttons/NewCourseButton'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import ConfirmationModal from '@components/Objects/StyledElements/ConfirmationModal/ConfirmationModal'
import { useSearchParams } from 'next/navigation'
import React, { useState, useMemo } from 'react'
import useAdminStatus from '@components/Hooks/useAdminStatus'
import { getAPIUrl } from '@services/config/config'
import { useOrg } from '@components/Contexts/OrgContext'
import { Download, Copy } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { PlanLevel } from '@services/plans/plans'
import { OrgUsageResponse, orgUsageFetcher } from '@services/orgs/usage'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { deleteCourseFromBackend, cloneCourse } from '@services/courses/courses'
import { exportCoursesBatch, downloadBlob, ExportStatus } from '@services/courses/transfer'
import { exportToast } from '@components/Objects/StyledElements/Toast/ExportToast'
import { swrFetcher } from '@services/utils/ts/requests'
import { getUserGroups, getUserGroupResources } from '@services/usergroups/usergroups'
import { mutate } from 'swr'
import useSWR from 'swr'
import toast from 'react-hot-toast'
import FeatureDisabledView from '@components/Dashboard/Shared/FeatureDisabled/FeatureDisabledView'
import { usePlan } from '@components/Hooks/usePlan'

type CourseProps = {
  orgslug: string
  courses: any
  org_id: string | number
}

function CoursesHome(params: CourseProps) {
  const { t } = useTranslation()
  const searchParams = useSearchParams()
  const isCreatingCourse = searchParams.get('new') ? true : false
  const [newCourseModal, setNewCourseModal] = React.useState(isCreatingCourse)
  const [importCourseModal, setImportCourseModal] = React.useState(false)
  const [importType, setImportType] = React.useState<'select' | 'scorm' | 'learnhouse'>('select')
  const [creationType, setCreationType] = React.useState<'select' | 'scratch' | 'ai'>('select')
  const [aiCourseModalOpen, setAiCourseModalOpen] = React.useState(false)
  const orgslug = params.orgslug
  const isUserAdmin = useAdminStatus() as any
  const org = useOrg() as any
  const currentPlan = usePlan()
  const session = useLHSession() as any
  const access_token = session.data?.tokens?.access_token

  // Check if courses feature is enabled
  const isCoursesEnabled = org?.config?.config?.resolved_features?.courses?.enabled ?? org?.config?.config?.features?.courses?.enabled !== false

  // SWR for courses data - only fetch if feature is enabled
  const { data: coursesData, mutate: mutateCourses } = useSWR(
    isCoursesEnabled && access_token ? `${getAPIUrl()}courses/org_slug/${orgslug}/page/1/limit/500?include_unpublished=true` : null,
    (url) => swrFetcher(url, access_token),
    { fallbackData: params.courses, revalidateOnFocus: true }
  )

  const allCourses = coursesData || params.courses

  // Fetch usage limits from backend
  const { data: usageData } = useSWR<OrgUsageResponse>(
    access_token && params.org_id ? `${getAPIUrl()}orgs/${params.org_id}/usage` : null,
    (url) => orgUsageFetcher(url, access_token),
    { revalidateOnFocus: true }
  )

  // Check course creation limit from backend
  const courseLimitReached = usageData?.features?.courses?.limit_reached ?? false
  const courseLimit = usageData?.features?.courses?.limit ?? 0

  // Usergroup filter — only shown on personal/family plans
  const usergroupsAvailable = currentPlan === 'personal' || currentPlan === 'family'
  const [usergroups, setUsergroups] = useState<any[]>([])
  const [selectedUsergroupId, setSelectedUsergroupId] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('lh_course_usergroup_filter') || ''
    }
    return ''
  })
  const [usergroupResourceUuids, setUsergroupResourceUuids] = useState<Set<string> | null>(null)
  const [showUsergroupInfo, setShowUsergroupInfo] = useState(false)

  // Fetch usergroups
  React.useEffect(() => {
    if (!usergroupsAvailable || !access_token || !params.org_id) return
    getUserGroups(params.org_id, access_token)
      .then((res: any) => {
        const list = Array.isArray(res) ? res : res?.data || []
        setUsergroups(list)
        // Clear saved selection if the usergroup no longer exists
        if (selectedUsergroupId && !list.some((ug: any) => String(ug.id) === selectedUsergroupId)) {
          setSelectedUsergroupId('')
          localStorage.removeItem('lh_course_usergroup_filter')
        }
      })
      .catch(() => setUsergroups([]))
  }, [usergroupsAvailable, access_token, params.org_id])

  // Fetch resource UUIDs for selected usergroup
  React.useEffect(() => {
    if (!selectedUsergroupId || !access_token || !params.org_id) {
      setUsergroupResourceUuids(null)
      return
    }
    getUserGroupResources(selectedUsergroupId, params.org_id, access_token)
      .then((res: any) => {
        const uuids = Array.isArray(res) ? res : res?.data || []
        setUsergroupResourceUuids(new Set(uuids))
      })
      .catch(() => setUsergroupResourceUuids(null))
  }, [selectedUsergroupId, access_token, params.org_id])

  const handleUsergroupChange = (value: string) => {
    setSelectedUsergroupId(value)
    if (value) {
      localStorage.setItem('lh_course_usergroup_filter', value)
    } else {
      localStorage.removeItem('lh_course_usergroup_filter')
    }
  }

  // Search state
  const [searchQuery, setSearchQuery] = useState('')

  // Filter courses based on search and usergroup (client-side)
  const filteredCourses = useMemo(() => {
    let courses = allCourses

    // Usergroup filter
    if (usergroupResourceUuids) {
      courses = courses.filter((course: any) => usergroupResourceUuids.has(course.course_uuid))
    }

    // Search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase()
      courses = courses.filter((course: any) =>
        course.name?.toLowerCase().includes(query) ||
        course.description?.toLowerCase().includes(query) ||
        course.tags?.toLowerCase().includes(query)
      )
    }

    return courses
  }, [allCourses, searchQuery, usergroupResourceUuids])

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = 12

  // Reset to page 1 when search or filter changes
  React.useEffect(() => {
    setCurrentPage(1)
  }, [searchQuery, selectedUsergroupId])

  // Calculate pagination (client-side)
  const totalPages = Math.ceil(filteredCourses.length / itemsPerPage)
  const paginatedCourses = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage
    return filteredCourses.slice(startIndex, startIndex + itemsPerPage)
  }, [filteredCourses, currentPage, itemsPerPage])

  // Selection state
  const [selectedCourses, setSelectedCourses] = useState<Set<string>>(new Set())

  async function closeNewCourseModal() {
    setNewCourseModal(false)
    setCreationType('select')
    mutateCourses()
  }

  const handleCreationTypeSelect = (type: 'scratch' | 'ai') => {
    if (type === 'ai') {
      setNewCourseModal(false)
      setAiCourseModalOpen(true)
    } else {
      setCreationType('scratch')
    }
  }

  const closeAICourseModal = () => {
    setAiCourseModalOpen(false)
    setCreationType('select')
    mutateCourses()
  }

  const getNewCourseModalContent = () => {
    switch (creationType) {
      case 'scratch':
        return (
          <CreateCourseModal
            closeModal={closeNewCourseModal}
            orgslug={orgslug}
          />
        )
      default:
        return <CourseCreationTypeSelector onSelectType={handleCreationTypeSelect} currentPlan={currentPlan} />
    }
  }

  const getNewCourseModalTitle = () => {
    switch (creationType) {
      case 'scratch':
        return t('dashboard.courses.create_course')
      default:
        return t('courses.create.choose_type')
    }
  }

  const getNewCourseModalDescription = () => {
    switch (creationType) {
      case 'scratch':
        return t('dashboard.courses.create_new_course')
      default:
        return t('courses.create.choose_type_description')
    }
  }

  async function closeImportCourseModal() {
    setImportCourseModal(false)
    setImportType('select')
    mutateCourses()
  }

  const handleImportTypeSelect = (type: 'scorm' | 'learnhouse') => {
    setImportType(type)
  }

  const getImportModalContent = () => {
    switch (importType) {
      case 'scorm':
        return (
          <ScormCourseImport
            orgId={Number(params.org_id)}
            orgslug={orgslug}
            closeModal={closeImportCourseModal}
          />
        )
      case 'learnhouse':
        return (
          <LearnHouseCourseImport
            orgId={Number(params.org_id)}
            orgslug={orgslug}
            closeModal={closeImportCourseModal}
          />
        )
      default:
        return <ImportTypeSelector onSelectType={handleImportTypeSelect} currentPlan={currentPlan} />
    }
  }

  const getImportModalTitle = () => {
    switch (importType) {
      case 'scorm':
        return t('dashboard.courses.import_scorm')
      case 'learnhouse':
        return t('dashboard.courses.import_learnhouse')
      default:
        return t('dashboard.courses.import_course')
    }
  }

  const getImportModalDescription = () => {
    switch (importType) {
      case 'scorm':
        return t('dashboard.courses.import_scorm_description')
      case 'learnhouse':
        return t('dashboard.courses.import_learnhouse_description')
      default:
        return t('dashboard.courses.import_select_type')
    }
  }

  // Toggle course selection
  const toggleCourseSelection = (courseUuid: string) => {
    const newSelection = new Set(selectedCourses)
    if (newSelection.has(courseUuid)) {
      newSelection.delete(courseUuid)
    } else {
      newSelection.add(courseUuid)
    }
    setSelectedCourses(newSelection)
  }

  // Select all visible courses (on current page)
  const selectAllCourses = () => {
    const allCourseUuids = paginatedCourses.map((course: any) => course.course_uuid)
    setSelectedCourses(new Set(allCourseUuids))
  }

  // Clear selection
  const clearSelection = () => {
    setSelectedCourses(new Set())
  }

  // Bulk delete courses
  const bulkDeleteCourses = async () => {
    const toastId = toast.loading(t('courses.deleting_courses', { count: selectedCourses.size }))
    let successCount = 0
    let errorCount = 0

    for (const courseUuid of selectedCourses) {
      try {
        await deleteCourseFromBackend(courseUuid, access_token)
        successCount++
      } catch (error) {
        errorCount++
      }
    }

    toast.dismiss(toastId)
    if (errorCount === 0) {
      toast.success(t('courses.courses_deleted_success', { count: successCount }))
    } else {
      toast.error(t('courses.courses_deleted_partial', { success: successCount, error: errorCount }))
    }

    clearSelection()
    mutateCourses()
  }

  // Bulk clone courses
  const bulkCloneCourses = async () => {
    const toastId = toast.loading(t('courses.cloning_courses', { count: selectedCourses.size }))
    let successCount = 0
    let errorCount = 0

    for (const courseUuid of selectedCourses) {
      try {
        const result = await cloneCourse(courseUuid, access_token)
        if (result.success) {
          successCount++
        } else {
          errorCount++
        }
      } catch (error) {
        errorCount++
      }
    }

    toast.dismiss(toastId)
    if (errorCount === 0) {
      toast.success(t('courses.courses_cloned_success', { count: successCount }))
    } else {
      toast.error(t('courses.courses_cloned_partial', { success: successCount, error: errorCount }))
    }

    clearSelection()
    mutateCourses()
  }

  // Bulk export courses
  const bulkExportCourses = async () => {
    const count = selectedCourses.size
    const toastId = exportToast.start('batch', undefined, count)

    try {
      const blob = await exportCoursesBatch(
        Array.from(selectedCourses),
        access_token,
        (progress, status) => {
          exportToast.update(toastId, status as ExportStatus, progress, undefined, count, 'batch')
        }
      )
      const timestamp = new Date().toISOString().split('T')[0]
      downloadBlob(blob, `learnhouse-courses-export-${timestamp}.zip`)
      exportToast.complete(toastId, undefined, count, 'batch')
    } catch (error: any) {
      exportToast.error(toastId, error.message || t('courses.courses_exported_error'), undefined, count, 'batch')
    }
    clearSelection()
  }

  // Pagination handlers
  const goToPage = (page: number) => {
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page)
      setSelectedCourses(new Set())
    }
  }

  const getVisiblePageNumbers = () => {
    const pages: (number | string)[] = []
    const maxVisible = 5

    if (totalPages <= maxVisible) {
      for (let i = 1; i <= totalPages; i++) pages.push(i)
    } else {
      if (currentPage <= 3) {
        for (let i = 1; i <= 4; i++) pages.push(i)
        pages.push('...')
        pages.push(totalPages)
      } else if (currentPage >= totalPages - 2) {
        pages.push(1)
        pages.push('...')
        for (let i = totalPages - 3; i <= totalPages; i++) pages.push(i)
      } else {
        pages.push(1)
        pages.push('...')
        for (let i = currentPage - 1; i <= currentPage + 1; i++) pages.push(i)
        pages.push('...')
        pages.push(totalPages)
      }
    }
    return pages
  }

  return (
    <FeatureDisabledView featureName="courses" orgslug={orgslug} context="dashboard">
    <div className="h-full w-full bg-[#f8f8f8] pl-10 pr-10">
      <div className="mb-6 pt-6">
        <Breadcrumbs items={[
          { label: t('courses.courses'), href: '/dash/courses', icon: <BookCopy size={14} /> }
        ]} />
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mt-4">
          <div className="flex items-center space-x-4">
            <h1 className="text-3xl font-bold mb-4 sm:mb-0">{t('dashboard.courses.title')}</h1>
          </div>
          <AuthenticatedClientElement
            checkMethod="roles"
            action="create"
            ressourceType="courses"
            orgId={params.org_id}
          >
            <div className="flex items-center space-x-2">
              {courseLimitReached && (
                <div className="text-xs text-gray-500 bg-gray-100 px-3 py-2 rounded-lg">
                  {t('dashboard.courses.limit_reached', { limit: courseLimit })}
                </div>
              )}
              <Modal
                isDialogOpen={importCourseModal}
                onOpenChange={(open) => {
                  if (courseLimitReached) return
                  setImportCourseModal(open)
                  if (!open) setImportType('select')
                }}
                minHeight="no-min"
                dialogTitle={getImportModalTitle()}
                dialogDescription={getImportModalDescription()}
                dialogContent={getImportModalContent()}
                dialogTrigger={
                  <button
                    disabled={courseLimitReached}
                    className={`rounded-lg bg-black transition-all duration-100 ease-linear antialiased p-2 px-5 my-auto font text-xs font-bold text-white nice-shadow flex space-x-2 items-center ${
                      courseLimitReached ? 'opacity-50 cursor-not-allowed' : 'hover:scale-105'
                    }`}
                  >
                    <Download className="w-4 h-4" />
                    <span>{t('dashboard.courses.import_course')}</span>
                  </button>
                }
              />
              <Modal
                isDialogOpen={newCourseModal}
                onOpenChange={(open) => {
                  if (courseLimitReached) return
                  setNewCourseModal(open)
                  if (!open) setCreationType('select')
                }}
                minHeight={creationType === 'select' ? 'no-min' : 'md'}
                minWidth={creationType === 'select' ? 'md' : 'lg'}
                dialogContent={getNewCourseModalContent()}
                dialogTitle={getNewCourseModalTitle()}
                dialogDescription={getNewCourseModalDescription()}
                dialogTrigger={
                  <button disabled={courseLimitReached}>
                    <NewCourseButton disabled={courseLimitReached} />
                  </button>
                }
              />
              <AICourseCreationModal
                isOpen={aiCourseModalOpen}
                onClose={closeAICourseModal}
                orgId={Number(params.org_id)}
                orgslug={orgslug}
                accessToken={access_token}
              />
            </div>
          </AuthenticatedClientElement>
        </div>
      </div>

      {/* Search, Usergroup Filter, and Selection Controls */}
      {allCourses.length > 0 && (
        <div className="mb-6 flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
          <div className="flex items-center gap-3 w-full sm:w-auto">
            {/* Search Input */}
            <div className="relative w-full sm:w-80">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('courses.search_courses')}
                className="w-full pl-10 pr-10 py-2.5 bg-white nice-shadow rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-black focus:ring-offset-2 border-0"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Usergroup Filter */}
            {usergroupsAvailable && usergroups.length > 0 && (
              <div className="relative flex items-center gap-1.5">
                <div className="relative">
                  <Users className="absolute left-2.5 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4 pointer-events-none" />
                  <select
                    value={selectedUsergroupId}
                    onChange={(e) => handleUsergroupChange(e.target.value)}
                    className="pl-8 pr-8 py-2.5 bg-white nice-shadow rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-black focus:ring-offset-2 border-0 appearance-none cursor-pointer min-w-[160px]"
                  >
                    <option value="">{t('courses.usergroup_filter.all_courses')}</option>
                    {usergroups.map((ug: any) => (
                      <option key={ug.id} value={String(ug.id)}>
                        {ug.name}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  onClick={() => setShowUsergroupInfo(!showUsergroupInfo)}
                  className="p-1.5 text-gray-400 hover:text-gray-600 transition-colors rounded-md hover:bg-gray-100"
                >
                  <Info className="w-3.5 h-3.5" />
                </button>
                {showUsergroupInfo && (
                  <div className="absolute top-full left-0 mt-2 z-50 w-72 bg-white nice-shadow rounded-lg p-3 border border-gray-100">
                    <p className="text-xs font-semibold text-gray-700 mb-1">{t('courses.usergroup_filter.info_title')}</p>
                    <p className="text-xs text-gray-500 leading-relaxed">{t('courses.usergroup_filter.info_description')}</p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Bulk Actions - shown when items selected */}
          {selectedCourses.size > 0 && (
            <AuthenticatedClientElement
              checkMethod="roles"
              action="update"
              ressourceType="courses"
              orgId={params.org_id}
            >
              <div className="flex items-center gap-2 ml-auto">
                <span className="text-sm font-medium text-gray-500 px-2">
                  {t('courses.selected_count', { count: selectedCourses.size })}
                </span>
                <button
                  onClick={selectAllCourses}
                  className="flex items-center gap-2 px-3 py-2 text-sm text-gray-600 hover:text-gray-900 bg-white nice-shadow rounded-lg transition-colors"
                >
                  <span>{t('courses.select_all')}</span>
                </button>
                <button
                  onClick={clearSelection}
                  className="flex items-center gap-2 px-3 py-2 text-sm text-gray-600 hover:text-gray-900 bg-white nice-shadow rounded-lg transition-colors"
                >
                  <X className="w-4 h-4" />
                  <span>{t('courses.clear_selection')}</span>
                </button>
                <ConfirmationModal
                  confirmationButtonText={t('courses.clone_selected')}
                  confirmationMessage={t('courses.clone_selected_confirm', { count: selectedCourses.size })}
                  dialogTitle={t('courses.clone_courses_title')}
                  dialogTrigger={
                    <button className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:text-gray-900 bg-white nice-shadow rounded-lg transition-colors">
                      <Copy className="w-4 h-4" />
                      <span>{t('courses.clone_selected')}</span>
                    </button>
                  }
                  functionToExecute={bulkCloneCourses}
                  status="info"
                />
                <button
                  onClick={bulkExportCourses}
                  className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:text-gray-900 bg-white nice-shadow rounded-lg transition-colors"
                >
                  <Download className="w-4 h-4" />
                  <span>{t('courses.export_selected')}</span>
                </button>
                <ConfirmationModal
                  confirmationButtonText={t('courses.delete_selected')}
                  confirmationMessage={t('courses.delete_selected_confirm', { count: selectedCourses.size })}
                  dialogTitle={t('courses.delete_courses_title')}
                  dialogTrigger={
                    <button className="flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:text-red-700 bg-white nice-shadow rounded-lg transition-colors">
                      <Trash2 className="w-4 h-4" />
                      <span>{t('courses.delete_selected')}</span>
                    </button>
                  }
                  functionToExecute={bulkDeleteCourses}
                  status="warning"
                />
              </div>
            </AuthenticatedClientElement>
          )}
        </div>
      )}

      {/* Search Results Info */}
      {searchQuery && (
        <div className="mb-4 text-sm text-gray-500">
          {t('courses.search_results', { count: filteredCourses.length, query: searchQuery })}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {paginatedCourses.map((course: any) => (
          <CourseThumbnail
            key={course.course_uuid}
            customLink={`/dash/courses/course/${removeCoursePrefix(course.course_uuid)}/general`}
            course={course}
            orgslug={orgslug}
            isDashboard={true}
            isSelected={selectedCourses.has(course.course_uuid)}
            onToggleSelect={toggleCourseSelection}
          />
        ))}
        {filteredCourses.length === 0 && searchQuery && (
          <div className="col-span-full flex justify-center items-center py-8">
            <div className="text-center">
              <Search className="w-12 h-12 text-gray-300 mx-auto mb-4" />
              <h2 className="text-xl font-semibold text-gray-600 mb-2">
                {t('courses.no_search_results')}
              </h2>
              <p className="text-gray-400">
                {t('courses.try_different_search')}
              </p>
            </div>
          </div>
        )}
        {allCourses.length === 0 && !searchQuery && (
          <div className="col-span-full flex justify-center items-center py-8">
            <div className="text-center">
              <div className="mb-4">
                <svg
                  width="120"
                  height="120"
                  viewBox="0 0 295 295"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  className="mx-auto"
                >
                  {/* ... SVG content ... */}
                </svg>
              </div>
              <h2 className="text-2xl font-bold text-gray-600 mb-2">
                {t('dashboard.courses.no_courses')}
              </h2>
              <p className="text-lg text-gray-400">
                {isUserAdmin ? (
                  t('dashboard.courses.create_course_placeholder')
                ) : (
                  t('dashboard.courses.no_courses_available')
                )}
              </p>
              {isUserAdmin && !courseLimitReached && (
                <div className="mt-6">
                  <AuthenticatedClientElement
                    action="create"
                    ressourceType="courses"
                    checkMethod="roles"
                    orgId={params.org_id}
                  >
                    <button onClick={() => setNewCourseModal(true)}>
                      <NewCourseButton />
                    </button>
                  </AuthenticatedClientElement>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Pagination Controls */}
      {totalPages > 1 && (
        <div className="mt-8 mb-6 flex items-center justify-center gap-2">
          <button
            onClick={() => goToPage(currentPage - 1)}
            disabled={currentPage === 1}
            className="flex items-center gap-1 px-3 py-2 text-sm font-medium text-gray-600 bg-white nice-shadow rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
            <span className="hidden sm:inline">{t('pagination.previous')}</span>
          </button>

          <div className="flex items-center gap-1">
            {getVisiblePageNumbers().map((page, index) => (
              <React.Fragment key={index}>
                {page === '...' ? (
                  <span className="px-2 py-1 text-gray-400">...</span>
                ) : (
                  <button
                    onClick={() => goToPage(page as number)}
                    className={`px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
                      currentPage === page
                        ? 'bg-black text-white'
                        : 'bg-white text-gray-600 nice-shadow hover:bg-gray-50'
                    }`}
                  >
                    {page}
                  </button>
                )}
              </React.Fragment>
            ))}
          </div>

          <button
            onClick={() => goToPage(currentPage + 1)}
            disabled={currentPage === totalPages}
            className="flex items-center gap-1 px-3 py-2 text-sm font-medium text-gray-600 bg-white nice-shadow rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <span className="hidden sm:inline">{t('pagination.next')}</span>
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Pagination info */}
      {totalPages > 1 && (
        <div className="mb-6 text-center text-sm text-gray-500">
          {t('pagination.showing_page', { current: currentPage, total: totalPages })}
        </div>
      )}
    </div>
    </FeatureDisabledView>
  )
}

export default CoursesHome
