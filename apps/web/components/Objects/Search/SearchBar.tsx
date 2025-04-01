import { useDebounce } from '@/hooks/useDebounce'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import { getUriWithOrg } from '@services/config/config'
import { searchOrgCourses } from '@services/courses/courses'
import { getCourseThumbnailMediaDirectory } from '@services/media/media'
import { Search } from 'lucide-react'
import Link from 'next/link'
import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { removeCoursePrefix } from '../Thumbnails/CourseThumbnail'

interface Course {
  name: string
  description: string
  thumbnail_image: string
  course_uuid: string
  authors: Array<{
    first_name: string
    last_name: string
    avatar_image: string
  }>
}

interface SearchBarProps {
  orgslug: string
  className?: string
  isMobile?: boolean
}

export const SearchBar: React.FC<SearchBarProps> = ({
  orgslug,
  className = '',
  isMobile = false,
}) => {
  const org = useOrg() as any
  const [searchQuery, setSearchQuery] = useState('')
  const [courses, setCourses] = useState<Course[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [showResults, setShowResults] = useState(false)
  const searchRef = useRef<HTMLDivElement>(null)
  const session = useLHSession() as any
  const debouncedSearch = useDebounce(searchQuery, 300)

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        searchRef.current &&
        !searchRef.current.contains(event.target as Node)
      ) {
        setShowResults(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    const fetchCourses = async () => {
      if (debouncedSearch.trim().length === 0) {
        setCourses([])
        return
      }

      setIsLoading(true)
      try {
        const results = await searchOrgCourses(
          orgslug,
          debouncedSearch,
          1,
          5,
          null,
          session?.data?.tokens?.access_token
        )
        setCourses(results)
      } catch (error) {
        console.error('Error searching courses:', error)
        setCourses([])
      }
      setIsLoading(false)
    }
    fetchCourses()
  }, [debouncedSearch, orgslug, session?.data?.tokens?.access_token])

  const handleSearchFocus = () => {
    if (searchQuery.trim().length > 0) {
      setShowResults(true)
    }
  }

  return (
    <div ref={searchRef} className={`relative ${className}`}>
      <div className="relative">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value)
            setShowResults(true)
          }}
          onFocus={handleSearchFocus}
          placeholder="Search courses..."
          className="h-9 w-full rounded-lg border border-gray-200 bg-white/50 pr-4 pl-10 text-sm placeholder:text-gray-400 focus:border-transparent focus:ring-2 focus:ring-gray-200 focus:outline-hidden"
        />
        <Search
          className="absolute top-1/2 left-3 -translate-y-1/2 transform text-gray-400"
          size={18}
        />
      </div>

      {showResults && (searchQuery.trim().length > 0 || isLoading) && (
        <div
          className={`absolute z-50 mt-2 max-h-[400px] w-full overflow-y-auto rounded-lg border border-gray-100 bg-white shadow-lg ${isMobile ? 'max-w-full' : 'min-w-[400px]'}`}
        >
          {isLoading ? (
            <div className="p-4 text-center text-gray-500">
              <div className="animate-pulse">Searching...</div>
            </div>
          ) : courses.length > 0 ? (
            <div className="py-2">
              {courses.map((course) => (
                <Link
                  key={course.course_uuid}
                  prefetch
                  href={getUriWithOrg(
                    orgslug,
                    `/course/${removeCoursePrefix(course.course_uuid)}`
                  )}
                  className="block transition-colors hover:bg-gray-50"
                  onClick={() => setShowResults(false)}
                >
                  <div className="flex items-center space-x-3 p-3">
                    {course.thumbnail_image && (
                      <img
                        src={getCourseThumbnailMediaDirectory(
                          org?.org_uuid,
                          course.course_uuid,
                          course.thumbnail_image
                        )}
                        alt={course.name}
                        className="h-12 w-12 rounded-lg object-cover"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-sm font-medium text-gray-900">
                        {course.name}
                      </h3>
                      <p className="truncate text-xs text-gray-500">
                        {course.description}
                      </p>
                      {course.authors && course.authors[0] && (
                        <p className="mt-1 text-xs text-gray-400">
                          by {course.authors[0].first_name}{' '}
                          {course.authors[0].last_name}
                        </p>
                      )}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="p-4 text-center text-gray-500">
              No courses found
            </div>
          )}
        </div>
      )}
    </div>
  )
}
