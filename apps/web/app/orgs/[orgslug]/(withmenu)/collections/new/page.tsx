'use client'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import { getAPIUrl, getUriWithOrg } from '@services/config/config'
import { createCollection } from '@services/courses/collections'
import { getCourseThumbnailMediaDirectory } from '@services/media/media'
import { revalidateTags, swrFetcher } from '@services/utils/ts/requests'
import { Image as ImageIcon, Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import React, { useState } from 'react'
import { toast } from 'react-hot-toast'
import useSWR from 'swr'

function NewCollection(params: any) {
  const org = useOrg() as any
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const orgslug = params.params.orgslug
  const [name, setName] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [selectedCourses, setSelectedCourses] = React.useState([]) as any
  const [isSubmitting, setIsSubmitting] = useState(false)
  const router = useRouter()
  const {
    data: courses,
    error,
    isLoading,
  } = useSWR(
    `${getAPIUrl()}courses/org_slug/${orgslug}/page/1/limit/10`,
    (url) => swrFetcher(url, access_token)
  )
  const [isPublic, setIsPublic] = useState('true')

  const handleVisibilityChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setIsPublic(e.target.value)
  }

  const handleNameChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setName(event.target.value)
  }

  const handleDescriptionChange = (
    event: React.ChangeEvent<HTMLTextAreaElement>
  ) => {
    setDescription(event.target.value)
  }

  const handleSubmit = async (e: any) => {
    e.preventDefault()

    if (!name.trim()) {
      toast.error('Please enter a collection name')
      return
    }

    if (!description.trim()) {
      toast.error('Please enter a description')
      return
    }

    if (selectedCourses.length === 0) {
      toast.error('Please select at least one course')
      return
    }

    setIsSubmitting(true)
    try {
      const collection = {
        name: name.trim(),
        description: description.trim(),
        courses: selectedCourses,
        public: isPublic,
        org_id: org.id,
      }
      await createCollection(collection, session.data?.tokens?.access_token)
      await revalidateTags(['collections'], org.slug)
      toast.success('Collection created successfully!')
      router.push(getUriWithOrg(orgslug, '/collections'))
    } catch (error) {
      toast.error('Failed to create collection. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (error) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <div className="text-red-500">
          Failed to load courses. Please try again later.
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <div className="space-y-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            Create New Collection
          </h1>
          <p className="mt-2 text-sm text-gray-600">
            Group your courses together in a collection to make them easier to
            find and manage.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-4">
            <label className="block">
              <span className="text-sm font-medium text-gray-700">
                Collection Name
              </span>
              <input
                type="text"
                placeholder="Enter collection name"
                value={name}
                onChange={handleNameChange}
                className="mt-1 block w-full rounded-lg border border-gray-300 px-4 py-2 transition focus:border-transparent focus:ring-2 focus:ring-blue-500 focus:outline-hidden"
                maxLength={100}
              />
            </label>

            <label className="block">
              <span className="text-sm font-medium text-gray-700">
                Visibility
              </span>
              <select
                onChange={handleVisibilityChange}
                className="mt-1 block w-full rounded-lg border border-gray-300 px-4 py-2 transition focus:border-transparent focus:ring-2 focus:ring-blue-500 focus:outline-hidden"
                defaultValue={isPublic}
              >
                <option value="true">
                  Public Collection - Visible to everyone
                </option>
                <option value="false">
                  Private Collection - Only visible to organization members
                </option>
              </select>
            </label>

            <label className="block">
              <span className="text-sm font-medium text-gray-700">
                Description
              </span>
              <textarea
                placeholder="Enter collection description"
                value={description}
                onChange={handleDescriptionChange}
                rows={4}
                className="mt-1 block w-full rounded-lg border border-gray-300 px-4 py-2 transition focus:border-transparent focus:ring-2 focus:ring-blue-500 focus:outline-hidden"
                maxLength={500}
              />
            </label>

            <div className="space-y-2">
              <span className="text-sm font-medium text-gray-700">
                Select Courses
              </span>
              {isLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-gray-500" />
                </div>
              ) : courses?.length === 0 ? (
                <p className="py-4 text-sm text-gray-500">
                  No courses available. Create some courses first.
                </p>
              ) : (
                <div className="mt-2 rounded-lg border border-gray-200 bg-gray-50">
                  <div className="scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-transparent hover:scrollbar-thumb-gray-400 max-h-[400px] space-y-3 overflow-y-auto p-4">
                    {courses?.map((course: any) => (
                      <label
                        key={course.id}
                        className="relative flex cursor-pointer items-center gap-4 rounded-md bg-white p-4 transition hover:bg-gray-50"
                      >
                        <input
                          type="checkbox"
                          id={course.id}
                          name={course.name}
                          value={course.id}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedCourses([
                                ...selectedCourses,
                                course.id,
                              ])
                            } else {
                              setSelectedCourses(
                                selectedCourses.filter(
                                  (id: any) => id !== course.id
                                )
                              )
                            }
                          }}
                          className="h-4 w-4 rounded border-gray-300 text-blue-500 focus:ring-blue-500"
                        />
                        <div className="relative h-16 w-24 shrink-0 overflow-hidden rounded-md bg-gray-100">
                          {course.thumbnail_image ? (
                            <img
                              src={getCourseThumbnailMediaDirectory(
                                org.org_uuid,
                                course.course_uuid,
                                course.thumbnail_image
                              )}
                              alt={course.name}
                              className="object-cover"
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center">
                              <ImageIcon className="h-6 w-6 text-gray-400" />
                            </div>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <h3 className="truncate text-sm font-medium text-gray-900">
                            {course.name}
                          </h3>
                          {course.description && (
                            <p className="mt-1 line-clamp-2 text-xs text-gray-500">
                              {course.description}
                            </p>
                          )}
                        </div>
                      </label>
                    ))}
                  </div>
                  <div className="border-t border-gray-200 bg-gray-50 px-4 py-3">
                    <p className="text-xs text-gray-500">
                      Selected courses: {selectedCourses.length}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center justify-end space-x-4">
            <button
              type="button"
              onClick={() => router.back()}
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:outline-hidden"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex items-center space-x-2 rounded-lg bg-blue-600 px-6 py-2 text-sm font-medium text-white shadow-xs transition hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:outline-hidden disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
              <span>{isSubmitting ? 'Creating...' : 'Create Collection'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default NewCollection
