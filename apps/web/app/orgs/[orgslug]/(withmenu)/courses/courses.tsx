'use client'
import CreateCourseModal from '@components/Objects/Modals/Course/Create/CreateCourse'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import React, { useState, useMemo, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import GeneralWrapperStyled from '@components/Objects/StyledElements/Wrappers/GeneralWrapper'
import TypeOfContentTitle from '@components/Objects/StyledElements/Titles/TypeOfContentTitle'
import AuthenticatedClientElement from '@components/Security/AuthenticatedClientElement'
import CourseThumbnail from '@components/Objects/Thumbnails/CourseThumbnail'
import NewCourseButton from '@components/Objects/StyledElements/Buttons/NewCourseButton'
import useAdminStatus from '@components/Hooks/useAdminStatus'
import { useTranslation } from 'react-i18next'
import { BookCopy, Search, X, Users, Info } from 'lucide-react'
import FeatureGate from '@components/Dashboard/Shared/FeatureGate/FeatureGate'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { searchMatchesAny } from '@/lib/search/normalize'
import { getUserGroups, getUserGroupResources } from '@services/usergroups/usergroups'
import { useCourses } from '@/hooks/queries/useCourses'
import { useLHAnalytics, AnalyticsEvent } from '@services/analytics'
import CatalogPagination, { useCatalogPagination } from '@components/Objects/Catalog/CatalogPagination'

interface CourseProps {
  orgslug: string
}

function Courses(props: CourseProps) {
  const { t } = useTranslation()
  const orgslug = props.orgslug
  const searchParams = useSearchParams()
  const isCreatingCourse = searchParams.get('new') ? true : false
  const [newCourseModal, setNewCourseModal] = React.useState(isCreatingCourse)
  const { isAdmin: isUserAdmin } = useAdminStatus()
  const org = useOrg() as any
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const { track } = useLHAnalytics('learner')
  const { data: coursesData, isLoading: coursesLoading } = useCourses(orgslug)

  const allCourses = coursesData || []

  // Usergroup filter — shown only when the org's plan actually includes
  // usergroups (a standard+ feature per the backend), via resolved features.
  const usergroupsAvailable = org?.config?.config?.resolved_features?.usergroups?.enabled ?? false
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
  useEffect(() => {
    if (!usergroupsAvailable || !access_token || !org?.id) return
    getUserGroups(org?.id, access_token)
      .then((res: any) => {
        const list = Array.isArray(res) ? res : res?.data || []
        setUsergroups(list)
        if (selectedUsergroupId && !list.some((ug: any) => String(ug.id) === selectedUsergroupId)) {
          setSelectedUsergroupId('')
          localStorage.removeItem('lh_course_usergroup_filter')
        }
      })
      .catch(() => setUsergroups([]))
  }, [usergroupsAvailable, access_token, org?.id])

  // Fetch resource UUIDs for selected usergroup
  useEffect(() => {
    if (!selectedUsergroupId || !access_token || !org?.id) {
      setUsergroupResourceUuids(null)
      return
    }
    getUserGroupResources(selectedUsergroupId, org?.id, access_token)
      .then((res: any) => {
        const uuids = Array.isArray(res) ? res : res?.data || []
        setUsergroupResourceUuids(new Set(uuids))
      })
      .catch(() => setUsergroupResourceUuids(null))
  }, [selectedUsergroupId, access_token, org?.id])

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

  // Filter courses based on search and usergroup
  const filteredCourses = useMemo(() => {
    let courses = allCourses

    // Usergroup filter
    if (usergroupResourceUuids) {
      courses = courses.filter((course: any) => usergroupResourceUuids.has(course.course_uuid))
    }

    // Search filter
    if (searchQuery.trim()) {
      courses = courses.filter((course: any) =>
        searchMatchesAny([course.name, course.description, course.tags], searchQuery)
      )
    }

    return courses
  }, [allCourses, searchQuery, usergroupResourceUuids])

  // Track non-empty searches (debounced so we don't fire on every keystroke)
  useEffect(() => {
    const query = searchQuery.trim()
    if (!query) return
    const timer = setTimeout(() => {
      track(AnalyticsEvent.CourseSearched, {
        results_count: filteredCourses.length,
        total_courses: allCourses.length,
      })
    }, 500)
    return () => clearTimeout(timer)
  }, [searchQuery, filteredCourses.length, allCourses.length, track])

  const {
    currentPage,
    totalPages,
    paginatedItems: paginatedCourses,
    pageNumbers,
    goToPage,
    resetPage,
  } = useCatalogPagination(filteredCourses)

  // Reset to page 1 when search or filter changes
  React.useEffect(() => {
    resetPage()
  }, [searchQuery, selectedUsergroupId, resetPage])

  async function closeNewCourseModal() {
    setNewCourseModal(false)
  }

  if (coursesLoading && !coursesData) {
    return (
      <div className="w-full animate-pulse">
        <GeneralWrapperStyled>
          <div className="flex flex-col space-y-2 mb-2">
            {/* Header row: title + button placeholder */}
            <div className="flex items-center justify-between mb-2">
              <div className="h-7 bg-gray-200 rounded w-28" />
              <div className="h-9 bg-gray-200 rounded-lg w-32" />
            </div>
            {/* Search bar placeholder */}
            <div className="h-10 bg-gray-200 rounded-lg w-full sm:w-80 mb-4" />
            {/* Course card grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="rounded-xl overflow-hidden">
                  {/* Thumbnail area */}
                  <div className="bg-gray-200 w-full h-40 rounded-xl" />
                  {/* Card body */}
                  <div className="pt-3 space-y-2">
                    <div className="h-4 bg-gray-200 rounded w-3/4" />
                    <div className="h-3 bg-gray-200 rounded w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </GeneralWrapperStyled>
      </div>
    )
  }

  return (
    <FeatureGate feature="courses" orgslug={orgslug} context="public">
    <div className="w-full">
      <GeneralWrapperStyled>
        <div className="flex flex-col space-y-2 mb-2">
          <div className="flex items-center justify-between">
            <TypeOfContentTitle title={t('courses.courses')} type="cou" />
            <AuthenticatedClientElement
              checkMethod="roles"
              action="create"
              ressourceType="courses"
              orgId={org?.id}
            >
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
                dialogTitle={t('courses.create_course')}
                dialogDescription={t('courses.create_new_course')}
                dialogTrigger={
                  <button>
                    <NewCourseButton />
                  </button>
                }
              />
            </AuthenticatedClientElement>
          </div>

          {/* Search and Usergroup Filter */}
          {allCourses.length > 0 && (
            <div className="flex items-center gap-3 mb-4 flex-wrap">
              <div className="relative w-full sm:w-80">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  aria-label={t('courses.search_courses')}
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
          )}

          {/* Search Results Info */}
          {searchQuery && (
            <div className="mb-2 text-sm text-gray-500">
              {t('courses.search_results', { count: filteredCourses.length, query: searchQuery })}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {paginatedCourses.map((course: any, index: number) => (
              <div key={course.course_uuid} className="">
                <CourseThumbnail course={course} orgslug={orgslug} isPriority={currentPage === 1 && index < 3} />
              </div>
            ))}
            {filteredCourses.length === 0 && searchQuery && (
              <div className="col-span-full flex flex-col justify-center items-center py-12 px-4">
                <Search className="w-12 h-12 text-gray-300 mb-4" />
                <h2 className="text-xl font-semibold text-gray-600 mb-2">
                  {t('courses.no_search_results')}
                </h2>
                <p className="text-gray-400">
                  {t('courses.try_different_search')}
                </p>
              </div>
            )}
            {allCourses.length === 0 && !searchQuery && (
              <div className="col-span-full flex flex-col justify-center items-center py-12 px-4 border-2 border-dashed border-gray-100 rounded-2xl bg-gray-50/30">
                <div className="p-4 bg-white rounded-full nice-shadow mb-4">
                  <BookCopy className="w-8 h-8 text-gray-300" strokeWidth={1.5} />
                </div>
                <h1 className="text-xl font-bold text-gray-600 mb-2">
                  {t('courses.no_courses')}
                </h1>
                <p className="text-md text-gray-400 mb-6 text-center max-w-xs">
                  {isUserAdmin ? (
                    t('courses.create_courses_placeholder')
                  ) : (
                    t('courses.no_courses_available')
                  )}
                </p>
                {isUserAdmin && (
                  <div className="mt-4">
                    <AuthenticatedClientElement
                      action="create"
                      ressourceType="courses"
                      checkMethod="roles"
                      orgId={org?.id}
                    >
                      <button onClick={() => setNewCourseModal(true)}>
                        <NewCourseButton />
                      </button>
                    </AuthenticatedClientElement>
                  </div>
                )}
              </div>
            )}
          </div>

          <CatalogPagination
            currentPage={currentPage}
            totalPages={totalPages}
            pageNumbers={pageNumbers}
            onPageChange={goToPage}
            previousLabel={t('pagination.previous')}
            nextLabel={t('pagination.next')}
            className="mt-8"
          />

          {/* Pagination info */}
          {totalPages > 1 && (
            <div className="mt-2 text-center text-sm text-gray-500">
              {t('pagination.showing_page', { current: currentPage, total: totalPages })}
            </div>
          )}
        </div>
      </GeneralWrapperStyled>
    </div>
    </FeatureGate>
  )
}

export default Courses
