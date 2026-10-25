'use client'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@components/ui/button'
import { Label } from '@components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@components/ui/select'
import BarLoader from 'react-spinners/BarLoader'
import {
  Upload,
  CheckCircle2,
  ChevronRight,
  ChevronDown,
  AlertCircle,
  FileArchive,
  ArrowLeft,
  RefreshCw,
  BookOpen,
  Layers,
} from 'lucide-react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { revalidateTags } from '@services/utils/ts/requests'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import {
  getLmsImportSources,
  getLmsImportStatus,
  importCourses,
  startLmsImport,
  LmsImportSource,
  LmsImportSourceKey,
  LmsImportStatus,
  LmsQuizMode,
} from '@services/courses/transfer'
import {
  CourseSelection,
  CourseSelectionList,
  ImportErrorMessage,
  ImportingState,
  ImportOptionsFields,
  ImportResults,
  ImportResultState,
  ImportStepIndicator,
} from './ImportShared'

const SUPPORTED_EXTENSIONS = ['.mbz', '.imscc', '.zip', '.tar.gz', '.tgz', '.gz']
const SUPPORTED_FILES = SUPPORTED_EXTENSIONS.join(',')

// Used until (or if) the backend list of sources loads
const FALLBACK_SOURCES: LmsImportSource[] = [
  { key: 'moodle', label: 'Moodle' },
  { key: 'canvas', label: 'Canvas' },
  { key: 'blackboard', label: 'Blackboard Learn' },
  { key: 'brightspace', label: 'D2L Brightspace' },
  { key: 'openedx', label: 'Open edX' },
  { key: 'common_cartridge', label: 'Common Cartridge' },
]

// Conversion runs in the background on the server, poll until it settles.
// Network errors are retried with a growing delay; a 404 is final.
const POLL_INTERVAL_MS = 2500
const MAX_POLL_INTERVAL_MS = 30000
const MAX_POLL_FAILURES = 10

// Long skipped/warning lists are cut to this many rows
const LIST_PREVIEW_LIMIT = 50
const GROUP_PREVIEW_LIMIT = 8

// report.counts keys, in display order, with their label
const COUNT_LABELS: [string, string][] = [
  ['TYPE_DYNAMIC', 'courses.import.lms_count_pages'],
  ['TYPE_VIDEO', 'courses.import.lms_count_videos'],
  ['TYPE_DOCUMENT', 'courses.import.lms_count_documents'],
  ['TYPE_ASSIGNMENT', 'courses.import.lms_count_assignments'],
  ['TYPE_SCORM', 'courses.import.lms_count_scorm'],
  ['questions', 'courses.import.lms_count_questions'],
  ['assignment_tasks', 'courses.import.lms_count_assignment_tasks'],
  ['media_image', 'courses.import.lms_count_images'],
  ['media_video', 'courses.import.lms_count_video_files'],
  ['media_audio', 'courses.import.lms_count_audio_files'],
  ['media_pdf', 'courses.import.lms_count_pdfs'],
  ['media_file', 'courses.import.lms_count_files'],
  ['transcoded', 'courses.import.lms_count_transcoded'],
  ['past_due_dates_removed', 'courses.import.lms_count_due_dates_removed'],
]

function isSupportedFile(file: File) {
  const name = file.name.toLowerCase()
  return SUPPORTED_EXTENSIONS.some((ext) => name.endsWith(ext))
}

interface LmsCourseImportProps {
  orgId: number
  orgslug: string
  closeModal: () => void
}

function LmsCourseImport({ orgId, orgslug, closeModal }: LmsCourseImportProps) {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const router = useRouter()

  // Step state: 'select' | 'converting' | 'failed' | 'configure' | 'importing' | 'complete'
  const [step, setStep] = useState<
    'select' | 'converting' | 'failed' | 'configure' | 'importing' | 'complete'
  >('select')

  // Select step state
  const [sources, setSources] = useState<LmsImportSource[]>(FALLBACK_SOURCES)
  const [source, setSource] = useState<LmsImportSourceKey | 'auto'>('auto')
  const [quizMode, setQuizMode] = useState<LmsQuizMode>('assignment')
  const [importFile, setImportFile] = useState<File | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [maxUploadMb, setMaxUploadMb] = useState<number | null>(null)
  const uploadAbort = useRef<AbortController | null>(null)

  // Converting step state: upload progress until the server answers with a temp_id
  const [uploadProgress, setUploadProgress] = useState(0)
  const [tempId, setTempId] = useState<string | null>(null)
  const [conversionError, setConversionError] = useState<string | null>(null)

  // Conversion result state
  const [conversion, setConversion] = useState<LmsImportStatus | null>(null)
  const [courseSelections, setCourseSelections] = useState<CourseSelection[]>([])

  // Import options state
  const [namePrefix, setNamePrefix] = useState('')
  const [setPrivate, setSetPrivate] = useState(true)
  const [setUnpublished, setSetUnpublished] = useState(true)

  // Import progress state
  const [isImporting, setIsImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [importResult, setImportResult] = useState<ImportResultState | null>(null)

  useEffect(() => {
    if (!access_token) return
    let cancelled = false
    getLmsImportSources(access_token)
      .then((result) => {
        if (cancelled) return
        if (result.sources?.length > 0) setSources(result.sources)
        if (result.max_upload_mb > 0) setMaxUploadMb(result.max_upload_mb)
      })
      .catch(() => {
        // Keep the built-in list
      })
    return () => {
      cancelled = true
    }
  }, [access_token])

  // Closing the dialog cancels an upload still in flight
  useEffect(() => () => uploadAbort.current?.abort(), [])

  const applyStatus = useCallback(
    (result: LmsImportStatus) => {
      if (result.status === 'ready') {
        setConversion(result)
        setCourseSelections(result.courses.map((course) => ({ ...course, include: true })))
        setStep('configure')
      } else if (result.status === 'failed') {
        setConversionError(result.error || t('courses.import.lms_conversion_failed_generic'))
        setStep('failed')
      }
    },
    [t]
  )

  // Poll the conversion status; stops when the step changes or on unmount
  useEffect(() => {
    if (step !== 'converting' || !tempId) return

    let cancelled = false
    let failures = 0
    let timer: ReturnType<typeof setTimeout>

    const poll = async () => {
      try {
        const result = await getLmsImportStatus(orgId, tempId, access_token)
        if (cancelled) return
        failures = 0
        if (result.status === 'processing') {
          timer = setTimeout(poll, POLL_INTERVAL_MS)
        } else {
          applyStatus(result)
        }
      } catch (error: any) {
        if (cancelled) return
        failures += 1
        // A 4xx cannot recover by retrying (gone, signed out, access removed)
        const final = error?.status >= 400 && error?.status < 500
        if (final || failures >= MAX_POLL_FAILURES) {
          setConversionError(
            (error?.status && error.message) || t('courses.import.lms_status_failed')
          )
          setStep('failed')
        } else {
          timer = setTimeout(
            poll,
            Math.min(POLL_INTERVAL_MS * 2 ** failures, MAX_POLL_INTERVAL_MS)
          )
        }
      }
    }

    timer = setTimeout(poll, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [step, tempId, orgId, access_token, applyStatus, t])

  // Returns the error to show for a file that cannot be uploaded
  const checkFile = (file: File): string | null => {
    if (!isSupportedFile(file)) return t('courses.import.lms_invalid_file_format')
    if (maxUploadMb && file.size > maxUploadMb * 1024 * 1024) {
      return t('courses.import.lms_file_too_large', { size: maxUploadMb })
    }
    return null
  }

  const pickFile = (file: File | undefined) => {
    if (!file) return
    const error = checkFile(file)
    setImportFile(error ? null : file)
    setUploadError(error)
  }

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    pickFile(event.target.files?.[0])
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) pickFile(file)
    else setUploadError(t('courses.import.lms_invalid_file_format'))
  }

  const handleStart = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!importFile || !orgId) return

    setUploadError(null)
    setConversionError(null)
    setUploadProgress(0)
    setTempId(null)
    setConversion(null)
    setStep('converting')

    uploadAbort.current?.abort()
    const controller = new AbortController()
    uploadAbort.current = controller
    try {
      const result = await startLmsImport(
        orgId,
        importFile,
        source,
        quizMode,
        access_token,
        setUploadProgress,
        controller.signal
      )
      if (controller.signal.aborted) return
      if (result.status === 'processing') {
        setTempId(result.temp_id)
      } else {
        applyStatus(result)
      }
    } catch (error: any) {
      if (controller.signal.aborted) return
      setUploadError(
        error?.status === 413 && maxUploadMb
          ? t('courses.import.lms_file_too_large', { size: maxUploadMb })
          : error.message || t('courses.import.lms_upload_failed')
      )
      setStep('select')
    } finally {
      if (uploadAbort.current === controller) uploadAbort.current = null
    }
  }

  const handleCourseSelectionChange = (course_uuid: string, include: boolean) => {
    setCourseSelections((prev) =>
      prev.map((course) =>
        course.course_uuid === course_uuid ? { ...course, include } : course
      )
    )
  }

  const handleSelectAll = () => {
    setCourseSelections((prev) => prev.map((course) => ({ ...course, include: true })))
  }

  const handleDeselectAll = () => {
    setCourseSelections((prev) => prev.map((course) => ({ ...course, include: false })))
  }

  const handleImport = async () => {
    if (!conversion || !orgId) return

    const selectedCourses = courseSelections.filter((c) => c.include)
    if (selectedCourses.length === 0) {
      setImportError(t('courses.import.select_at_least_one'))
      return
    }

    setIsImporting(true)
    setImportError(null)
    setStep('importing')

    try {
      const result = await importCourses(
        conversion.temp_id,
        orgId,
        {
          course_uuids: selectedCourses.map((c) => c.course_uuid),
          name_prefix: namePrefix || null,
          set_private: setPrivate,
          set_unpublished: setUnpublished,
        },
        access_token
      )

      setImportResult({
        successful: result.successful,
        failed: result.failed,
        courses: result.courses.map((c) => ({
          name:
            c.name ||
            selectedCourses.find((s) => s.course_uuid === c.original_uuid)?.name ||
            t('courses.import.lms_unknown_course'),
          uuid: c.new_uuid,
          success: c.success,
          error: c.error || undefined,
        })),
      })

      setStep('complete')

      // Revalidate courses
      await revalidateTags(['courses'], orgslug)
    } catch (error: any) {
      setImportError(error.message || t('courses.import.import_failed'))
      setStep('configure')
    } finally {
      setIsImporting(false)
    }
  }

  const handleComplete = () => {
    closeModal()
    router.refresh()
  }

  const resetToSelect = () => {
    setStep('select')
    setTempId(null)
    setConversion(null)
    setCourseSelections([])
    setImportFile(null)
    setNamePrefix('')
    setUploadError(null)
    setConversionError(null)
    setImportError(null)
    setImportResult(null)
  }

  const selectedCount = courseSelections.filter((c) => c.include).length
  const report = conversion?.report
  const counts = report
    ? COUNT_LABELS.filter(([key]) => (report.counts[key] || 0) > 0)
    : []
  const skipped = report?.skipped || []
  const skippedGroups = Array.from(
    skipped.reduce((groups, item) => {
      groups.set(item.kind, [...(groups.get(item.kind) || []), item])
      return groups
    }, new Map<string, typeof skipped>())
  ).sort((a, b) => b[1].length - a[1].length)
  const warnings = report?.warnings || []
  const moreWarnings =
    Math.max(warnings.length - LIST_PREVIEW_LIMIT, 0) + (report?.dropped_warnings || 0)

  // Step indicator
  const steps = [
    { key: 'select', label: t('courses.import.upload_package') },
    { key: 'configure', label: t('courses.import.configure') },
    { key: 'complete', label: t('courses.import.complete') },
  ]

  const currentStepIndex =
    step === 'configure' ? 1 : step === 'importing' || step === 'complete' ? 2 : 0

  return (
    <div className="min-w-[500px]">
      {/* Step Indicator */}
      <ImportStepIndicator steps={steps} currentStepIndex={currentStepIndex} />

      {/* Select Step */}
      {step === 'select' && (
        <form onSubmit={handleStart}>
          <div className="space-y-5">
            {/* Source platform */}
            <div className="space-y-1.5">
              <Label htmlFor="lms-source" className="text-sm font-medium text-gray-700">
                {t('courses.import.lms_source')}
              </Label>
              <Select value={source} onValueChange={(value) => setSource(value as LmsImportSourceKey | 'auto')}>
                <SelectTrigger id="lms-source">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">{t('courses.import.lms_auto_detect')}</SelectItem>
                  {sources.map((option) => (
                    <SelectItem key={option.key} value={option.key}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-gray-500">
                {t(`courses.import.lms_hint_${source}`, { defaultValue: '' })}
              </p>
            </div>

            {/* Quizzes */}
            <fieldset className="space-y-1.5">
              <legend className="text-sm font-medium text-gray-700">{t('courses.import.lms_quiz_mode')}</legend>
              <div className="rounded-lg border border-gray-200 divide-y divide-gray-100">
                {(['assignment', 'page'] as const).map((key) => (
                  <label key={key} className="flex items-start gap-3 p-3 cursor-pointer">
                    <input
                      type="radio"
                      name="lms-quiz-mode"
                      value={key}
                      checked={quizMode === key}
                      onChange={() => setQuizMode(key)}
                      className="mt-0.5 w-4 h-4 border-gray-300 text-black focus:ring-black focus:ring-offset-0"
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-gray-800">
                        {t(`courses.import.lms_quiz_${key}`)}
                      </span>
                      <span className="block text-xs text-gray-500">
                        {t(`courses.import.lms_quiz_${key}_hint`)}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            {/* File Upload Area */}
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`relative border-2 border-dashed rounded-xl p-6 text-center transition-all duration-200 focus-within:ring-2 focus-within:ring-black ${
                isDragging
                  ? 'border-black bg-gray-50 scale-[1.02]'
                  : importFile
                    ? 'border-green-300 bg-green-50'
                    : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
              }`}
            >
              <input
                id="lms-import-file"
                type="file"
                accept={SUPPORTED_FILES}
                onChange={handleFileChange}
                className="sr-only"
              />
              <label
                htmlFor="lms-import-file"
                className="cursor-pointer flex flex-col items-center space-y-3"
              >
                {importFile ? (
                  <>
                    <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center">
                      <FileArchive size={28} className="text-green-600" />
                    </div>
                    <div className="space-y-1">
                      <p className="font-semibold text-gray-900 break-all">{importFile.name}</p>
                      <p className="text-sm text-gray-500">
                        {(importFile.size / 1024 / 1024).toFixed(2)} MB
                      </p>
                      <p className="text-xs text-green-600 font-medium">
                        {t('courses.import.lms_ready_to_convert')}
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center">
                      <Upload size={28} className="text-gray-400" />
                    </div>
                    <div className="space-y-1">
                      <p className="font-medium text-gray-700">{t('courses.import.click_to_upload')}</p>
                      <p className="text-sm text-gray-400">{t('courses.import.lms_format')}</p>
                    </div>
                  </>
                )}
              </label>
            </div>

            {/* Error Message */}
            {uploadError && <ImportErrorMessage message={uploadError} />}

            {/* Info Box */}
            <div className="bg-blue-50 border border-blue-100 p-4 rounded-lg">
              <p className="text-sm text-blue-700">{t('courses.import.lms_info')}</p>
            </div>

            {/* Submit Button */}
            <div className="flex justify-end pt-2">
              <Button
                type="submit"
                disabled={!importFile}
                className="bg-black text-white hover:bg-gray-800 px-6 h-11"
              >
                <div className="flex items-center space-x-2">
                  <span>{t('courses.import.lms_start')}</span>
                  <ChevronRight size={18} />
                </div>
              </Button>
            </div>
          </div>
        </form>
      )}

      {/* Converting Step */}
      {step === 'converting' && (
        <div className="flex flex-col items-center justify-center py-12 space-y-4" aria-live="polite">
          <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center">
            {tempId ? (
              <BarLoader width={40} color="#000000" cssOverride={{ borderRadius: 60 }} />
            ) : (
              <Upload size={28} className="text-gray-500" />
            )}
          </div>
          {tempId ? (
            <>
              <p className="text-gray-600 font-medium">{t('courses.import.lms_converting')}</p>
              <p className="text-sm text-gray-400 text-center max-w-sm">
                {t('courses.import.lms_converting_hint')}
              </p>
            </>
          ) : (
            <>
              <p className="text-gray-600 font-medium">
                {uploadProgress >= 100
                  ? t('courses.import.lms_upload_finishing')
                  : t('courses.import.lms_uploading', { progress: uploadProgress })}
              </p>
              <div
                role="progressbar"
                aria-label={t('courses.import.lms_upload_progress')}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={uploadProgress}
                className="w-full max-w-xs h-2 bg-gray-100 rounded-full overflow-hidden"
              >
                <div
                  className="h-full bg-black transition-all duration-300"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
              {importFile && (
                <p className="text-sm text-gray-400 break-all text-center">{importFile.name}</p>
              )}
            </>
          )}
        </div>
      )}

      {/* Failed Step */}
      {step === 'failed' && (
        <div className="space-y-5">
          <div className="flex flex-col items-center justify-center py-8 space-y-3 text-center" role="alert">
            <div className="w-16 h-16 rounded-full bg-red-50 flex items-center justify-center">
              <AlertCircle size={28} className="text-red-600" />
            </div>
            <p className="font-semibold text-red-800">{t('courses.import.lms_conversion_failed')}</p>
            {conversionError && (
              <p className="text-sm text-gray-600 max-w-md break-words">{conversionError}</p>
            )}
          </div>

          {/* Actions */}
          <div className="flex justify-between items-center pt-2 border-t border-gray-100">
            <button
              type="button"
              onClick={resetToSelect}
              className="flex items-center space-x-1 text-sm text-gray-500 hover:text-gray-700 transition-colors"
            >
              <ArrowLeft size={16} />
              <span>{t('courses.import.upload_different')}</span>
            </button>
            <Button
              type="button"
              onClick={() => handleStart()}
              disabled={!importFile}
              className="bg-black text-white hover:bg-gray-800 px-6 h-11"
            >
              <div className="flex items-center space-x-2">
                <RefreshCw size={16} />
                <span>{t('courses.import.lms_retry')}</span>
              </div>
            </Button>
          </div>
        </div>
      )}

      {/* Configure Step */}
      {step === 'configure' && conversion && (
        <div className="space-y-5">
          {/* Success Banner */}
          <div className="flex items-center justify-between p-3 bg-green-50 border border-green-100 rounded-lg">
            <div className="flex items-center space-x-2">
              <CheckCircle2 size={18} className="text-green-600" />
              <span className="text-sm font-medium text-green-800">
                {t('courses.import.lms_converted')}
              </span>
            </div>
            {(conversion.source_label || conversion.source) && (
              <span className="text-xs font-medium text-green-700 bg-green-100 px-2 py-1 rounded-full">
                {t('courses.import.lms_detected', {
                  source: conversion.source_label || conversion.source,
                })}
              </span>
            )}
          </div>

          {/* Course Selection */}
          {courseSelections.length > 1 ? (
            <CourseSelectionList
              courses={courseSelections}
              onChange={handleCourseSelectionChange}
              onSelectAll={handleSelectAll}
              onDeselectAll={handleDeselectAll}
            />
          ) : courseSelections.length === 1 ? (
            <div className="p-3 rounded-lg border border-gray-200 bg-white shadow-sm">
              <p className="text-sm font-medium text-gray-800 truncate">{courseSelections[0].name}</p>
              {courseSelections[0].description && (
                <p className="text-xs text-gray-500 truncate mt-0.5">{courseSelections[0].description}</p>
              )}
              <div className="flex items-center gap-4 mt-2 text-xs text-gray-400">
                <span className="flex items-center gap-1">
                  <Layers size={12} />
                  <span>{courseSelections[0].chapters_count} {t('courses.import.chapters')}</span>
                </span>
                <span className="flex items-center gap-1">
                  <BookOpen size={12} />
                  <span>{courseSelections[0].activities_count} {t('courses.import.activities')}</span>
                </span>
              </div>
            </div>
          ) : (
            <ImportErrorMessage message={t('courses.import.lms_no_courses')} />
          )}

          {/* What the export turned into */}
          {counts.length > 0 && report && (
            <div className="flex flex-wrap gap-1.5">
              {counts.map(([key, label]) => (
                <span
                  key={key}
                  className="inline-flex items-center gap-1 rounded-md bg-gray-100 px-2 py-0.5 text-xs text-gray-700"
                >
                  <span className="font-semibold text-gray-900">{report.counts[key]}</span>
                  <span>{t(label)}</span>
                </span>
              ))}
            </div>
          )}

          {/* Skipped Items, grouped by kind so a long list of missing files reads at a glance */}
          {skipped.length > 0 && (
            <ReportSection
              id="lms-import-skipped"
              title={t('courses.import.lms_skipped', {
                count: skipped.length + (report?.dropped_skipped || 0),
              })}
              more={report?.dropped_skipped || 0}
            >
              {skippedGroups.map(([kind, items]) => (
                <li key={kind} className="text-xs text-gray-600">
                  <p className="font-medium text-gray-800 capitalize">
                    {kind} <span className="text-gray-400 font-normal">({items.length})</span>
                  </p>
                  <ul className="mt-1 space-y-1 ps-3 border-s border-gray-200">
                    {items.slice(0, GROUP_PREVIEW_LIMIT).map((item, index) => (
                      <li key={index} className="break-words">
                        <span className="text-gray-800">{item.title}</span>
                        {item.reason && <span className="text-gray-500">: {item.reason}</span>}
                      </li>
                    ))}
                    {items.length > GROUP_PREVIEW_LIMIT && (
                      <li className="text-gray-400">
                        {t('courses.import.lms_and_more', { count: items.length - GROUP_PREVIEW_LIMIT })}
                      </li>
                    )}
                  </ul>
                </li>
              ))}
            </ReportSection>
          )}

          {/* Warnings */}
          {warnings.length > 0 && (
            <ReportSection
              id="lms-import-warnings"
              title={t('courses.import.lms_warnings', {
                count: warnings.length + (report?.dropped_warnings || 0),
              })}
              more={moreWarnings}
            >
              {warnings.slice(0, LIST_PREVIEW_LIMIT).map((warning, index) => (
                <li key={index} className="text-xs text-gray-600 break-words">
                  {warning}
                </li>
              ))}
            </ReportSection>
          )}

          {/* Import Options */}
          <ImportOptionsFields
            namePrefix={namePrefix}
            onNamePrefixChange={setNamePrefix}
            setPrivate={setPrivate}
            onSetPrivateChange={setSetPrivate}
            setUnpublished={setUnpublished}
            onSetUnpublishedChange={setSetUnpublished}
          />

          {/* Error Message */}
          {importError && <ImportErrorMessage message={importError} />}

          {/* Actions */}
          <div className="flex justify-between items-center pt-2 border-t border-gray-100">
            <button
              type="button"
              onClick={resetToSelect}
              className="flex items-center space-x-1 text-sm text-gray-500 hover:text-gray-700 transition-colors"
            >
              <ArrowLeft size={16} />
              <span>{t('courses.import.upload_different')}</span>
            </button>
            <Button
              type="button"
              onClick={handleImport}
              disabled={selectedCount === 0 || isImporting}
              className="bg-black text-white hover:bg-gray-800 px-6 h-11"
            >
              <div className="flex items-center space-x-2">
                <span>
                  {t('courses.import.import_courses', { count: selectedCount })}
                </span>
                <ChevronRight size={18} />
              </div>
            </Button>
          </div>
        </div>
      )}

      {/* Importing Step */}
      {step === 'importing' && <ImportingState />}

      {/* Complete Step */}
      {step === 'complete' && importResult && (
        <ImportResults result={importResult} onDone={handleComplete} orgslug={orgslug} />
      )}
    </div>
  )
}

/**
 * Collapsible list in the conversion report (skipped items, warnings)
 */
function ReportSection({
  id,
  title,
  more,
  children,
}: {
  id: string
  title: string
  more: number
  children: React.ReactNode
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        className="w-full flex items-center justify-between gap-2 p-3 text-sm font-semibold text-gray-700 hover:text-black"
      >
        <span>{title}</span>
        <ChevronDown
          size={16}
          className={`flex-shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div id={id} className="px-3 pb-3">
          <ul className="space-y-1.5 max-h-[180px] overflow-y-auto pe-1">{children}</ul>
          {more > 0 && (
            <p className="mt-2 text-xs text-gray-400">
              {t('courses.import.lms_and_more', { count: more })}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

export default LmsCourseImport
