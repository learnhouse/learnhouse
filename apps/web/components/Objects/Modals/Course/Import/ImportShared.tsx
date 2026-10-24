'use client'
import React from 'react'
import Link from 'next/link'
import { Button } from '@components/ui/button'
import { Input } from '@components/ui/input'
import { Label } from '@components/ui/label'
import BarLoader from 'react-spinners/BarLoader'
import {
  CheckCircle2,
  AlertCircle,
  BookOpen,
  Layers,
  Image,
  ExternalLink,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { getUriWithOrg } from '@services/config/config'
import { removeCoursePrefix } from '@components/Objects/Thumbnails/CourseThumbnail'
import { ImportCourseInfo } from '@services/courses/transfer'

/**
 * Building blocks shared by the course import flows (LearnHouse package,
 * other LMS export): step indicator, course selection, import options,
 * progress and result views.
 */

export interface CourseSelection extends ImportCourseInfo {
  include: boolean
}

export interface ImportResultState {
  successful: number
  failed: number
  courses: { name: string; uuid: string; success: boolean; error?: string }[]
}

export function ImportStepIndicator({
  steps,
  currentStepIndex,
}: {
  steps: { key: string; label: string }[]
  currentStepIndex: number
}) {
  return (
    <div className="flex items-center justify-center mb-6">
      <div className="flex items-center space-x-3">
        {steps.map((s, index) => (
          <React.Fragment key={s.key}>
            {index > 0 && (
              <div className="w-12 h-[2px] bg-gray-200">
                <div
                  className={`h-full transition-all duration-300 ${
                    index <= currentStepIndex ? 'w-full bg-green-500' : 'w-0'
                  }`}
                />
              </div>
            )}
            <div
              className={`flex items-center space-x-2 ${
                index === currentStepIndex ? 'text-black' : index < currentStepIndex ? 'text-green-600' : 'text-gray-400'
              }`}
            >
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                  index < currentStepIndex
                    ? 'bg-green-500 text-white'
                    : index === currentStepIndex
                      ? 'bg-black text-white'
                      : 'bg-gray-200 text-gray-500'
                }`}
              >
                {index < currentStepIndex ? <CheckCircle2 size={16} /> : index + 1}
              </div>
              <span className="text-sm font-medium hidden sm:inline">{s.label}</span>
            </div>
          </React.Fragment>
        ))}
      </div>
    </div>
  )
}

export function ImportErrorMessage({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="flex items-center space-x-2 text-red-600 text-sm bg-red-50 p-3 rounded-lg border border-red-100"
    >
      <AlertCircle size={16} className="flex-shrink-0" />
      <span>{message}</span>
    </div>
  )
}

export function CourseSelectionList({
  courses,
  onChange,
  onSelectAll,
  onDeselectAll,
}: {
  courses: CourseSelection[]
  onChange: (course_uuid: string, include: boolean) => void
  onSelectAll: () => void
  onDeselectAll: () => void
}) {
  const { t } = useTranslation()
  const selectedCount = courses.filter((c) => c.include).length

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-semibold text-gray-700">
          {t('courses.import.select_courses')}
        </Label>
        <div className="flex items-center space-x-2">
          <button
            type="button"
            onClick={onSelectAll}
            className="text-xs text-blue-600 hover:text-blue-800"
          >
            {t('courses.import.select_all')}
          </button>
          <span className="text-gray-300">|</span>
          <button
            type="button"
            onClick={onDeselectAll}
            className="text-xs text-gray-500 hover:text-gray-700"
          >
            {t('courses.import.deselect_all')}
          </button>
        </div>
      </div>

      <div className="space-y-2 max-h-[200px] overflow-y-auto pe-1">
        {courses.map((course) => (
          <div
            key={course.course_uuid}
            className={`p-3 rounded-lg border transition-all duration-200 ${
              course.include
                ? 'border-gray-200 bg-white shadow-sm'
                : 'border-gray-100 bg-gray-50 opacity-50'
            }`}
          >
            <div className="flex items-start space-x-3">
              <input
                type="checkbox"
                checked={course.include}
                onChange={(e) => onChange(course.course_uuid, e.target.checked)}
                aria-label={course.name}
                className="mt-0.5 w-4 h-4 rounded border-gray-300 text-black focus:ring-black focus:ring-offset-0"
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800 truncate">{course.name}</p>
                {course.description && (
                  <p className="text-xs text-gray-500 truncate mt-0.5">{course.description}</p>
                )}
                <div className="flex items-center space-x-4 mt-2 text-xs text-gray-400">
                  <span className="flex items-center space-x-1">
                    <Layers size={12} />
                    <span>{course.chapters_count} {t('courses.import.chapters')}</span>
                  </span>
                  <span className="flex items-center space-x-1">
                    <BookOpen size={12} />
                    <span>{course.activities_count} {t('courses.import.activities')}</span>
                  </span>
                  {course.has_thumbnail && (
                    <span className="flex items-center space-x-1">
                      <Image size={12} />
                      <span>{t('courses.import.has_thumbnail')}</span>
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="text-end text-xs text-gray-500">
        {selectedCount} {t('common.of')} {courses.length} {t('courses.import.selected')}
      </div>
    </div>
  )
}

export function ImportOptionsFields({
  namePrefix,
  onNamePrefixChange,
  setPrivate,
  onSetPrivateChange,
  setUnpublished,
  onSetUnpublishedChange,
}: {
  namePrefix: string
  onNamePrefixChange: (value: string) => void
  setPrivate: boolean
  onSetPrivateChange: (value: boolean) => void
  setUnpublished: boolean
  onSetUnpublishedChange: (value: boolean) => void
}) {
  const { t } = useTranslation()

  return (
    <div className="space-y-4 p-4 bg-gray-50 rounded-lg border border-gray-100">
      <h3 className="text-sm font-semibold text-gray-700">{t('courses.import.options')}</h3>

      <div className="space-y-3">
        <div>
          <Label htmlFor="name-prefix" className="text-sm font-medium text-gray-700">
            {t('courses.import.name_prefix')}
          </Label>
          <Input
            id="name-prefix"
            value={namePrefix}
            onChange={(e) => onNamePrefixChange(e.target.value)}
            placeholder={t('courses.import.name_prefix_placeholder')}
            className="mt-1.5"
          />
        </div>

        <div className="flex items-center space-x-6">
          <label className="flex items-center space-x-2 cursor-pointer">
            <input
              type="checkbox"
              checked={setPrivate}
              onChange={(e) => onSetPrivateChange(e.target.checked)}
              className="w-4 h-4 rounded border-gray-300 text-black focus:ring-black focus:ring-offset-0"
            />
            <span className="text-sm text-gray-700">{t('courses.import.set_private')}</span>
          </label>

          <label className="flex items-center space-x-2 cursor-pointer">
            <input
              type="checkbox"
              checked={setUnpublished}
              onChange={(e) => onSetUnpublishedChange(e.target.checked)}
              className="w-4 h-4 rounded border-gray-300 text-black focus:ring-black focus:ring-offset-0"
            />
            <span className="text-sm text-gray-700">{t('courses.import.set_unpublished')}</span>
          </label>
        </div>
      </div>
    </div>
  )
}

export function ImportingState() {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col items-center justify-center py-12 space-y-4">
      <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center">
        <BarLoader width={40} color="#000000" cssOverride={{ borderRadius: 60 }} />
      </div>
      <p className="text-gray-600 font-medium">{t('courses.import.importing_courses')}</p>
      <p className="text-sm text-gray-400">{t('courses.import.please_wait')}</p>
    </div>
  )
}

/**
 * Result of an import. When `orgslug` is given, each created course links to
 * its dashboard page (navigating away unmounts the import modal).
 */
export function ImportResults({
  result,
  onDone,
  orgslug,
}: {
  result: ImportResultState
  onDone: () => void
  orgslug?: string
}) {
  const { t } = useTranslation()

  return (
    <div className="space-y-5">
      {/* Result Banner */}
      <div
        className={`flex items-center justify-between p-4 rounded-lg border ${
          result.failed === 0
            ? 'bg-green-50 border-green-100'
            : result.successful === 0
              ? 'bg-red-50 border-red-100'
              : 'bg-yellow-50 border-yellow-100'
        }`}
      >
        <div className="flex items-center space-x-3">
          <CheckCircle2
            size={24}
            className={
              result.failed === 0
                ? 'text-green-600'
                : result.successful === 0
                  ? 'text-red-600'
                  : 'text-yellow-600'
            }
          />
          <div>
            <p
              className={`font-semibold ${
                result.failed === 0
                  ? 'text-green-800'
                  : result.successful === 0
                    ? 'text-red-800'
                    : 'text-yellow-800'
              }`}
            >
              {result.failed === 0
                ? t('courses.import.import_complete')
                : result.successful === 0
                  ? t('courses.import.import_failed')
                  : t('courses.import.import_partial')}
            </p>
            <p className="text-sm text-gray-600">
              {t('courses.import.import_summary', {
                successful: result.successful,
                total: result.successful + result.failed,
              })}
            </p>
          </div>
        </div>
      </div>

      {/* Course Results */}
      <div className="space-y-2 max-h-[200px] overflow-y-auto pe-1">
        {result.courses.map((course, index) => (
          <div
            key={index}
            className={`p-3 rounded-lg border ${
              course.success
                ? 'border-green-100 bg-green-50'
                : 'border-red-100 bg-red-50'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                {course.success ? (
                  <CheckCircle2 size={16} className="text-green-600" />
                ) : (
                  <AlertCircle size={16} className="text-red-600" />
                )}
                <span
                  className={`text-sm font-medium ${
                    course.success ? 'text-green-800' : 'text-red-800'
                  }`}
                >
                  {course.name}
                </span>
              </div>
              {course.success && orgslug && course.uuid ? (
                <Link
                  prefetch={false}
                  href={getUriWithOrg(orgslug, `/dash/courses/course/${removeCoursePrefix(course.uuid)}/content`)}
                  className="flex items-center gap-1 text-xs font-medium text-green-700 hover:text-green-900"
                >
                  <span>{t('courses.import.open_course')}</span>
                  <ExternalLink size={12} />
                </Link>
              ) : (
                course.success && (
                  <span className="text-xs text-green-600">{t('courses.import.created')}</span>
                )
              )}
            </div>
            {course.error && (
              <p className="text-xs text-red-600 mt-1 ps-6">{course.error}</p>
            )}
          </div>
        ))}
      </div>

      {/* Action */}
      <div className="flex justify-end pt-2 border-t border-gray-100">
        <Button
          type="button"
          onClick={onDone}
          className="bg-black text-white hover:bg-gray-800 px-6 h-11"
        >
          {t('courses.import.done')}
        </Button>
      </div>
    </div>
  )
}
