'use client'
import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import { useCommunity, useCommunityDispatch } from '@components/Contexts/CommunityContext'
import { linkCommunityToCourse, unlinkCommunityFromCourse } from '@services/communities/communities'
import { getOrgCourses } from '@services/courses/courses'
import { revalidateTags } from '@services/utils/ts/requests'
import { mutate } from 'swr'
import { getAPIUrl } from '@services/config/config'
import { Loader2, Link2, Unlink, Search, BookOpen } from 'lucide-react'
import toast from 'react-hot-toast'
import { Input } from '@components/ui/input'
import { Button } from '@components/ui/button'

interface Course {
  id: number
  course_uuid: string
  name: string
  description: string
}

const CommunityEditCourse: React.FC = () => {
  const { t } = useTranslation()
  const router = useRouter()
  const session = useLHSession() as any
  const org = useOrg() as any
  const communityState = useCommunity()
  const dispatch = useCommunityDispatch()
  const community = communityState?.community
  const accessToken = session?.data?.tokens?.access_token

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [courses, setCourses] = useState<Course[]>([])
  const [isLoadingCourses, setIsLoadingCourses] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCourse, setSelectedCourse] = useState<string | null>(null)

  useEffect(() => {
    const fetchCourses = async () => {
      if (!org?.slug) return

      setIsLoadingCourses(true)
      try {
        const result = await getOrgCourses(org.slug, null, accessToken)
        setCourses(result || [])
      } catch (error) {
        console.error('Failed to fetch courses:', error)
      } finally {
        setIsLoadingCourses(false)
      }
    }

    fetchCourses()
  }, [org?.slug, accessToken])

  if (!community) return null

  const filteredCourses = courses.filter((course) =>
    course.name.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const linkedCourse = courses.find((c) => c.id === community.course_id)

  const handleLink = async () => {
    if (!selectedCourse) return

    setIsSubmitting(true)
    const loadingToast = toast.loading(t('dashboard.courses.communities.course.toasts.linking'))

    try {
      await linkCommunityToCourse(community.community_uuid, selectedCourse, accessToken)
      await revalidateTags(['communities'], org.slug)
      mutate(`${getAPIUrl()}communities/${community.community_uuid}`)
      toast.success(t('dashboard.courses.communities.course.toasts.link_success'), { id: loadingToast })
      setSelectedCourse(null)
      router.refresh()
    } catch (error) {
      console.error('Failed to link course:', error)
      toast.error(t('dashboard.courses.communities.course.toasts.link_error'), { id: loadingToast })
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleUnlink = async () => {
    setIsSubmitting(true)
    const loadingToast = toast.loading(t('dashboard.courses.communities.course.toasts.unlinking'))

    try {
      await unlinkCommunityFromCourse(community.community_uuid, accessToken)
      await revalidateTags(['communities'], org.slug)
      mutate(`${getAPIUrl()}communities/${community.community_uuid}`)
      toast.success(t('dashboard.courses.communities.course.toasts.unlink_success'), { id: loadingToast })
      router.refresh()
    } catch (error) {
      console.error('Failed to unlink course:', error)
      toast.error(t('dashboard.courses.communities.course.toasts.unlink_error'), { id: loadingToast })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="sm:mx-10 mx-0 bg-white rounded-xl nice-shadow">
      <div className="flex flex-col gap-0">
        <div className="flex flex-col bg-gray-50 -space-y-1 px-5 py-3 mx-3 my-3 rounded-md">
          <h1 className="font-bold text-xl text-gray-800">{t('dashboard.courses.communities.course.title')}</h1>
          <h2 className="text-gray-500 text-md">
            {t('dashboard.courses.communities.course.subtitle')}
          </h2>
        </div>

        <div className="mx-5 my-5 space-y-6">
          {/* Currently linked course */}
          {community.course_id && linkedCourse && (
            <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center">
                    <BookOpen size={20} className="text-gray-600" />
                  </div>
                  <div>
                    <p className="font-medium text-gray-900">{linkedCourse.name}</p>
                    <p className="text-xs text-gray-500">{t('dashboard.courses.communities.course.currently_linked')}</p>
                  </div>
                </div>
                <Button
                  onClick={handleUnlink}
                  disabled={isSubmitting}
                  variant="ghost"
                  className="text-red-600 hover:text-red-700 hover:bg-red-50"
                >
                  {isSubmitting ? (
                    <Loader2 size={14} className="animate-spin mr-2" />
                  ) : (
                    <Unlink size={14} className="mr-2" />
                  )}
                  {t('dashboard.courses.communities.course.unlink')}
                </Button>
              </div>
            </div>
          )}

          {community.course_id && !linkedCourse && (
            <div className="p-4 bg-yellow-50 border border-yellow-100 rounded-lg">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-yellow-900">{t('dashboard.courses.communities.course.course_linked_id', { id: community.course_id })}</p>
                  <p className="text-xs text-yellow-600 mt-1">
                    {t('dashboard.courses.communities.course.course_not_found')}
                  </p>
                </div>
                <Button
                  onClick={handleUnlink}
                  disabled={isSubmitting}
                  variant="ghost"
                  className="text-red-600 hover:text-red-700 hover:bg-red-50"
                >
                  {isSubmitting ? (
                    <Loader2 size={14} className="animate-spin mr-2" />
                  ) : (
                    <Unlink size={14} className="mr-2" />
                  )}
                  {t('dashboard.courses.communities.course.unlink')}
                </Button>
              </div>
            </div>
          )}

          {/* Course selection */}
          {!community.course_id && (
            <>
              {/* Search */}
              <div className="relative max-w-md">
                <Search
                  size={18}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                />
                <Input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={t('dashboard.courses.communities.course.search_placeholder')}
                  className="pl-10"
                />
              </div>

              {/* Course List */}
              <div className="max-h-80 overflow-y-auto border border-gray-200 rounded-lg">
                {isLoadingCourses ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 size={24} className="animate-spin text-gray-400" />
                  </div>
                ) : filteredCourses.length === 0 ? (
                  <div className="text-center py-12 text-gray-500">
                    <BookOpen size={32} className="mx-auto mb-2 text-gray-300" />
                    <p className="text-sm">{t('dashboard.courses.communities.course.no_courses')}</p>
                  </div>
                ) : (
                  <div className="divide-y divide-gray-100">
                    {filteredCourses.map((course) => (
                      <button
                        key={course.course_uuid}
                        onClick={() => setSelectedCourse(course.course_uuid)}
                        className={`w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors ${
                          selectedCourse === course.course_uuid
                            ? 'bg-gray-100 border-l-4 border-black'
                            : ''
                        }`}
                      >
                        <p className="font-medium text-gray-900 text-sm">{course.name}</p>
                        {course.description && (
                          <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">
                            {course.description}
                          </p>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Link button */}
              <div className="flex justify-end">
                <Button
                  onClick={handleLink}
                  disabled={isSubmitting || !selectedCourse}
                  className="bg-black text-white hover:bg-black/90"
                >
                  {isSubmitting ? (
                    <Loader2 size={16} className="animate-spin mr-2" />
                  ) : (
                    <Link2 size={16} className="mr-2" />
                  )}
                  {t('dashboard.courses.communities.course.link_button')}
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default CommunityEditCourse
