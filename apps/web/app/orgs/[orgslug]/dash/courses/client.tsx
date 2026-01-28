'use client'
import { Breadcrumbs } from '@components/Objects/Breadcrumbs/Breadcrumbs'
import CreateCourseModal from '@components/Objects/Modals/Course/Create/CreateCourse'
import { BookCopy, Search, X, Trash2, CheckSquare, Square, ChevronLeft, ChevronRight } from 'lucide-react'
import ScormCourseImport from '../../../../../ee/components/Modals/ScormCourseImport'
import CourseThumbnail, { removeCoursePrefix } from '@components/Objects/Thumbnails/CourseThumbnail'
import AuthenticatedClientElement from '@components/Security/AuthenticatedClientElement'
import NewCourseButton from '@components/Objects/StyledElements/Buttons/NewCourseButton'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import ConfirmationModal from '@components/Objects/StyledElements/ConfirmationModal/ConfirmationModal'
import { useSearchParams } from 'next/navigation'
import React, { useState, useMemo } from 'react'
import useAdminStatus from '@components/Hooks/useAdminStatus'
import useEnterprisePlan from '@components/Hooks/useEnterprisePlan'
import { getAPIUrl } from '@services/config/config'
import { useOrg } from '@components/Contexts/OrgContext'
import { Download, Copy } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import PlanBadge from '@components/Dashboard/Shared/PlanRestricted/PlanBadge'
import { PlanLevel } from '@services/plans/plans'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { deleteCourseFromBackend, cloneCourse } from '@services/courses/courses'
import { swrFetcher } from '@services/utils/ts/requests'
import { mutate } from 'swr'
import useSWR from 'swr'
import toast from 'react-hot-toast'

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
  const orgslug = params.orgslug
  const isUserAdmin = useAdminStatus() as any
  const org = useOrg() as any
  const { isEnterprise } = useEnterprisePlan()
  const currentPlan: PlanLevel = org?.config?.config?.cloud?.plan || 'free'
  const session = useLHSession() as any
  const access_token = session.data?.tokens?.access_token

  // SWR for courses data - fetch all at once for client-side filtering (include unpublished for dashboard)
  const { data: coursesData, mutate: mutateCourses } = useSWR(
    access_token ? `${getAPIUrl()}courses/org_slug/${orgslug}/page/1/limit/500?include_unpublished=true` : null,
    (url) => swrFetcher(url, access_token),
    { fallbackData: params.courses, revalidateOnFocus: true }
  )

  const allCourses = coursesData || params.courses

  // Search state
  const [searchQuery, setSearchQuery] = useState('')

  // Filter courses based on search (client-side)
  const filteredCourses = useMemo(() => {
    if (!searchQuery.trim()) return allCourses
    const query = searchQuery.toLowerCase()
    return allCourses.filter((course: any) =>
      course.name?.toLowerCase().includes(query) ||
      course.description?.toLowerCase().includes(query) ||
      course.tags?.toLowerCase().includes(query)
    )
  }, [allCourses, searchQuery])

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = 12

  // Reset to page 1 when search changes
  React.useEffect(() => {
    setCurrentPage(1)
  }, [searchQuery])

  // Calculate pagination (client-side)
  const totalPages = Math.ceil(filteredCourses.length / itemsPerPage)
  const paginatedCourses = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage
    return filteredCourses.slice(startIndex, startIndex + itemsPerPage)
  }, [filteredCourses, currentPage, itemsPerPage])

  // Selection state
  const [selectedCourses, setSelectedCourses] = useState<Set<string>>(new Set())
  const [isSelectionMode, setIsSelectionMode] = useState(false)

  async function closeNewCourseModal() {
    setNewCourseModal(false)
    mutateCourses()
  }

  async function closeImportCourseModal() {
    setImportCourseModal(false)
    mutateCourses()
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
    if (newSelection.size === 0) {
      setIsSelectionMode(false)
    }
  }

  // Select all visible courses (on current page)
  const selectAllCourses = () => {
    const allCourseUuids = paginatedCourses.map((course: any) => course.course_uuid)
    setSelectedCourses(new Set(allCourseUuids))
  }

  // Clear selection
  const clearSelection = () => {
    setSelectedCourses(new Set())
    setIsSelectionMode(false)
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
              {isEnterprise ? (
                <Modal
                  isDialogOpen={importCourseModal}
                  onOpenChange={setImportCourseModal}
                  minHeight="no-min"
                  dialogTitle={t('dashboard.courses.import_course')}
                  dialogDescription={t('dashboard.courses.import_scorm_description')}
                  dialogContent={
                    <ScormCourseImport
                      orgId={Number(params.org_id)}
                      orgslug={orgslug}
                      closeModal={closeImportCourseModal}
                    />
                  }
                  dialogTrigger={
                    <button className="rounded-lg bg-black hover:scale-105 transition-all duration-100 ease-linear antialiased p-2 px-5 my-auto font text-xs font-bold text-white nice-shadow flex space-x-2 items-center">
                      <Download className="w-4 h-4" />
                      <span>{t('dashboard.courses.import_course')}</span>
                    </button>
                  }
                />
              ) : (
                <button
                  disabled
                  className="rounded-lg bg-gray-300 antialiased p-2 px-5 my-auto font text-xs font-bold text-gray-500 flex items-center gap-2 cursor-not-allowed"
                >
                  <Download className="w-4 h-4" />
                  <span>{t('dashboard.courses.import_course')}</span>
                  <PlanBadge currentPlan={currentPlan} requiredPlan="enterprise" alwaysShow noMargin />
                </button>
              )}
              <Modal
                isDialogOpen={newCourseModal}
                onOpenChange={setNewCourseModal}
                minHeight="md"
                minWidth="lg"
                dialogContent={
                  <CreateCourseModal
                    closeModal={closeNewCourseModal}
                    orgslug={orgslug}
                  />
                }
                dialogTitle={t('dashboard.courses.create_course')}
                dialogDescription={t('dashboard.courses.create_new_course')}
                dialogTrigger={
                  <button>
                    <NewCourseButton />
                  </button>
                }
              />
            </div>
          </AuthenticatedClientElement>
        </div>
      </div>

      {/* Search and Selection Controls - Inline */}
      {allCourses.length > 0 && (
        <div className="mb-6 flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
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

          {/* Selection and Bulk Actions - Far Right */}
          <AuthenticatedClientElement
            checkMethod="roles"
            action="update"
            ressourceType="courses"
            orgId={params.org_id}
          >
            <div className="flex items-center gap-2 ml-auto">
              {!isSelectionMode ? (
                <button
                  onClick={() => setIsSelectionMode(true)}
                  className="flex items-center gap-2 px-3 py-2 text-sm text-gray-600 hover:text-gray-900 bg-white nice-shadow rounded-lg transition-colors"
                >
                  <CheckSquare className="w-4 h-4" />
                  <span>{t('courses.select_courses')}</span>
                </button>
              ) : (
                <>
                  <button
                    onClick={selectAllCourses}
                    className="flex items-center gap-2 px-3 py-2 text-sm text-gray-600 hover:text-gray-900 bg-white nice-shadow rounded-lg transition-colors"
                  >
                    <CheckSquare className="w-4 h-4" />
                    <span>{t('courses.select_all')}</span>
                  </button>
                  <button
                    onClick={clearSelection}
                    className="flex items-center gap-2 px-3 py-2 text-sm text-gray-600 hover:text-gray-900 bg-white nice-shadow rounded-lg transition-colors"
                  >
                    <X className="w-4 h-4" />
                    <span>{t('courses.clear_selection')}</span>
                  </button>

                  {/* Bulk actions - shown when items selected */}
                  {selectedCourses.size > 0 && (
                    <>
                      <span className="text-sm font-medium text-gray-500 px-2">
                        {t('courses.selected_count', { count: selectedCourses.size })}
                      </span>
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
                    </>
                  )}
                </>
              )}
            </div>
          </AuthenticatedClientElement>
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
          <div key={course.course_uuid} className="relative">
            {/* Selection Checkbox */}
            {isSelectionMode && (
              <button
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  toggleCourseSelection(course.course_uuid)
                }}
                className="absolute top-2 left-2 z-50 p-1.5 bg-white/90 backdrop-blur-sm rounded-full hover:bg-white transition-all shadow-md"
              >
                {selectedCourses.has(course.course_uuid) ? (
                  <CheckSquare className="w-5 h-5 text-black" />
                ) : (
                  <Square className="w-5 h-5 text-gray-400" />
                )}
              </button>
            )}
            <div className={`${selectedCourses.has(course.course_uuid) ? 'ring-2 ring-black ring-offset-2 rounded-xl' : ''}`}>
              <CourseThumbnail customLink={`/dash/courses/course/${removeCoursePrefix(course.course_uuid)}/general`} course={course} orgslug={orgslug} isDashboard={true} />
            </div>
          </div>
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
              {isUserAdmin && (
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
  )
}

export default CoursesHome
