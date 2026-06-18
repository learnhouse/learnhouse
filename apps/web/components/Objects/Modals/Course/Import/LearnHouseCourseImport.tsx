'use client'
import React, { useState } from 'react'
import { Button } from '@components/ui/button'
import { Input } from '@components/ui/input'
import { Label } from '@components/ui/label'
import BarLoader from 'react-spinners/BarLoader'
import {
  Upload,
  CheckCircle2,
  ChevronRight,
  AlertCircle,
  FileArchive,
  ArrowLeft,
  BookOpen,
  Layers,
  Image,
} from 'lucide-react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { constructAcceptValue } from '@/lib/constants'
import { revalidateTags } from '@services/utils/ts/requests'
import toast from 'react-hot-toast'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import {
  analyzeImportPackage,
  importCourses,
  ImportCourseInfo,
  ImportAnalysisResponse,
} from '@services/courses/transfer'

const SUPPORTED_FILES = constructAcceptValue(['zip'])

interface CourseSelection {
  course_uuid: string
  name: string
  description: string | null
  chapters_count: number
  activities_count: number
  has_thumbnail: boolean
  include: boolean
}

interface LearnHouseCourseImportProps {
  orgId: number
  orgslug: string
  closeModal: () => void
}

function LearnHouseCourseImport({
  orgId,
  orgslug,
  closeModal,
}: LearnHouseCourseImportProps) {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const router = useRouter()

  // Step state: 'upload' | 'configure' | 'importing' | 'complete'
  const [step, setStep] = useState<'upload' | 'configure' | 'importing' | 'complete'>('upload')

  // Upload step state
  const [importFile, setImportFile] = useState<File | null>(null)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  // Analysis result state
  const [analysisResult, setAnalysisResult] = useState<ImportAnalysisResponse | null>(null)

  // Course selection state
  const [courseSelections, setCourseSelections] = useState<CourseSelection[]>([])

  // Import options state
  const [namePrefix, setNamePrefix] = useState('')
  const [setPrivate, setSetPrivate] = useState(true)
  const [setUnpublished, setSetUnpublished] = useState(true)

  // Import progress state
  const [isImporting, setIsImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [importResult, setImportResult] = useState<{
    successful: number
    failed: number
    courses: { name: string; uuid: string; success: boolean; error?: string }[]
  } | null>(null)

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) {
      setImportFile(file)
      setUploadError(null)
    }
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
    if (file && file.name.endsWith('.zip')) {
      setImportFile(file)
      setUploadError(null)
    } else {
      setUploadError(t('courses.import.invalid_file_format'))
    }
  }

  const handleAnalyze = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!importFile || !orgId) return

    setIsAnalyzing(true)
    setUploadError(null)

    try {
      const result = await analyzeImportPackage(importFile, orgId, access_token)
      setAnalysisResult(result)

      // Initialize course selections
      setCourseSelections(
        result.courses.map((course) => ({
          ...course,
          include: true,
        }))
      )

      setStep('configure')
    } catch (error: any) {
      setUploadError(error.message || t('courses.import.analysis_failed'))
    } finally {
      setIsAnalyzing(false)
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
    if (!analysisResult || !orgId) return

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
        analysisResult.temp_id,
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
          name: c.name || selectedCourses.find((s) => s.course_uuid === c.original_uuid)?.name || 'Unknown',
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

  const resetToUpload = () => {
    setStep('upload')
    setAnalysisResult(null)
    setCourseSelections([])
    setImportFile(null)
    setNamePrefix('')
    setUploadError(null)
    setImportError(null)
    setImportResult(null)
  }

  const selectedCount = courseSelections.filter((c) => c.include).length
  const totalCount = courseSelections.length

  // Step indicator
  const steps = [
    { key: 'upload', label: t('courses.import.upload_package') },
    { key: 'configure', label: t('courses.import.configure') },
    { key: 'complete', label: t('courses.import.complete') },
  ]

  const currentStepIndex = step === 'importing' ? 2 : steps.findIndex((s) => s.key === step)

  return (
    <div className="min-w-[500px]">
      {/* Step Indicator */}
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

      {/* Upload Step */}
      {step === 'upload' && (
        <form onSubmit={handleAnalyze}>
          <div className="space-y-5">
            {/* File Upload Area */}
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`relative border-2 border-dashed rounded-xl p-8 text-center transition-all duration-200 ${
                isDragging
                  ? 'border-black bg-gray-50 scale-[1.02]'
                  : importFile
                    ? 'border-green-300 bg-green-50'
                    : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
              }`}
            >
              <input
                id="import-file"
                type="file"
                accept={SUPPORTED_FILES}
                onChange={handleFileChange}
                className="hidden"
                required
              />
              <label
                htmlFor="import-file"
                className="cursor-pointer flex flex-col items-center space-y-3"
              >
                {importFile ? (
                  <>
                    <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center">
                      <FileArchive size={28} className="text-green-600" />
                    </div>
                    <div className="space-y-1">
                      <p className="font-semibold text-gray-900">{importFile.name}</p>
                      <p className="text-sm text-gray-500">
                        {(importFile.size / 1024 / 1024).toFixed(2)} MB
                      </p>
                      <p className="text-xs text-green-600 font-medium">
                        {t('courses.import.ready_to_analyze')}
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
                      <p className="text-sm text-gray-400">{t('courses.import.learnhouse_format')}</p>
                    </div>
                  </>
                )}
              </label>
            </div>

            {/* Error Message */}
            {uploadError && (
              <div className="flex items-center space-x-2 text-red-600 text-sm bg-red-50 p-3 rounded-lg border border-red-100">
                <AlertCircle size={16} className="flex-shrink-0" />
                <span>{uploadError}</span>
              </div>
            )}

            {/* Info Box */}
            <div className="bg-blue-50 border border-blue-100 p-4 rounded-lg">
              <p className="text-sm text-blue-700">{t('courses.import.learnhouse_info')}</p>
            </div>

            {/* Submit Button */}
            <div className="flex justify-end pt-2">
              <Button
                type="submit"
                disabled={!importFile || isAnalyzing}
                className="bg-black text-white hover:bg-gray-800 px-6 h-11"
              >
                {isAnalyzing ? (
                  <div className="flex items-center space-x-2">
                    <BarLoader width={60} color="#ffffff" cssOverride={{ borderRadius: 60 }} />
                  </div>
                ) : (
                  <div className="flex items-center space-x-2">
                    <span>{t('courses.import.analyze_package')}</span>
                    <ChevronRight size={18} />
                  </div>
                )}
              </Button>
            </div>
          </div>
        </form>
      )}

      {/* Configure Step */}
      {step === 'configure' && analysisResult && (
        <div className="space-y-5">
          {/* Success Banner */}
          <div className="flex items-center justify-between p-3 bg-green-50 border border-green-100 rounded-lg">
            <div className="flex items-center space-x-2">
              <CheckCircle2 size={18} className="text-green-600" />
              <span className="text-sm font-medium text-green-800">
                {t('courses.import.package_analyzed')}
              </span>
            </div>
            <span className="text-xs font-medium text-green-700 bg-green-100 px-2 py-1 rounded-full">
              v{analysisResult.version}
            </span>
          </div>

          {/* Course Selection */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-semibold text-gray-700">
                {t('courses.import.select_courses')}
              </Label>
              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  onClick={handleSelectAll}
                  className="text-xs text-blue-600 hover:text-blue-800"
                >
                  {t('courses.import.select_all')}
                </button>
                <span className="text-gray-300">|</span>
                <button
                  type="button"
                  onClick={handleDeselectAll}
                  className="text-xs text-gray-500 hover:text-gray-700"
                >
                  {t('courses.import.deselect_all')}
                </button>
              </div>
            </div>

            <div className="space-y-2 max-h-[200px] overflow-y-auto pr-1">
              {courseSelections.map((course) => (
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
                      onChange={(e) =>
                        handleCourseSelectionChange(course.course_uuid, e.target.checked)
                      }
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

            <div className="text-right text-xs text-gray-500">
              {selectedCount} {t('common.of')} {totalCount} {t('courses.import.selected')}
            </div>
          </div>

          {/* Import Options */}
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
                  onChange={(e) => setNamePrefix(e.target.value)}
                  placeholder={t('courses.import.name_prefix_placeholder')}
                  className="mt-1.5"
                />
              </div>

              <div className="flex items-center space-x-6">
                <label className="flex items-center space-x-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={setPrivate}
                    onChange={(e) => setSetPrivate(e.target.checked)}
                    className="w-4 h-4 rounded border-gray-300 text-black focus:ring-black focus:ring-offset-0"
                  />
                  <span className="text-sm text-gray-700">{t('courses.import.set_private')}</span>
                </label>

                <label className="flex items-center space-x-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={setUnpublished}
                    onChange={(e) => setSetUnpublished(e.target.checked)}
                    className="w-4 h-4 rounded border-gray-300 text-black focus:ring-black focus:ring-offset-0"
                  />
                  <span className="text-sm text-gray-700">{t('courses.import.set_unpublished')}</span>
                </label>
              </div>
            </div>
          </div>

          {/* Error Message */}
          {importError && (
            <div className="flex items-center space-x-2 text-red-600 text-sm bg-red-50 p-3 rounded-lg border border-red-100">
              <AlertCircle size={16} className="flex-shrink-0" />
              <span>{importError}</span>
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-between items-center pt-2 border-t border-gray-100">
            <button
              type="button"
              onClick={resetToUpload}
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
      {step === 'importing' && (
        <div className="flex flex-col items-center justify-center py-12 space-y-4">
          <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center">
            <BarLoader width={40} color="#000000" cssOverride={{ borderRadius: 60 }} />
          </div>
          <p className="text-gray-600 font-medium">{t('courses.import.importing_courses')}</p>
          <p className="text-sm text-gray-400">{t('courses.import.please_wait')}</p>
        </div>
      )}

      {/* Complete Step */}
      {step === 'complete' && importResult && (
        <div className="space-y-5">
          {/* Result Banner */}
          <div
            className={`flex items-center justify-between p-4 rounded-lg border ${
              importResult.failed === 0
                ? 'bg-green-50 border-green-100'
                : importResult.successful === 0
                  ? 'bg-red-50 border-red-100'
                  : 'bg-yellow-50 border-yellow-100'
            }`}
          >
            <div className="flex items-center space-x-3">
              <CheckCircle2
                size={24}
                className={
                  importResult.failed === 0
                    ? 'text-green-600'
                    : importResult.successful === 0
                      ? 'text-red-600'
                      : 'text-yellow-600'
                }
              />
              <div>
                <p
                  className={`font-semibold ${
                    importResult.failed === 0
                      ? 'text-green-800'
                      : importResult.successful === 0
                        ? 'text-red-800'
                        : 'text-yellow-800'
                  }`}
                >
                  {importResult.failed === 0
                    ? t('courses.import.import_complete')
                    : importResult.successful === 0
                      ? t('courses.import.import_failed')
                      : t('courses.import.import_partial')}
                </p>
                <p className="text-sm text-gray-600">
                  {t('courses.import.import_summary', {
                    successful: importResult.successful,
                    total: importResult.successful + importResult.failed,
                  })}
                </p>
              </div>
            </div>
          </div>

          {/* Course Results */}
          <div className="space-y-2 max-h-[200px] overflow-y-auto pr-1">
            {importResult.courses.map((course, index) => (
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
                  {course.success && (
                    <span className="text-xs text-green-600">{t('courses.import.created')}</span>
                  )}
                </div>
                {course.error && (
                  <p className="text-xs text-red-600 mt-1 pl-6">{course.error}</p>
                )}
              </div>
            ))}
          </div>

          {/* Action */}
          <div className="flex justify-end pt-2 border-t border-gray-100">
            <Button
              type="button"
              onClick={handleComplete}
              className="bg-black text-white hover:bg-gray-800 px-6 h-11"
            >
              {t('courses.import.done')}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

export default LearnHouseCourseImport
