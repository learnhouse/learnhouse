'use client'
import React, { useState } from 'react'
import { Button } from '@components/ui/button'
import BarLoader from 'react-spinners/BarLoader'
import {
  Upload,
  CheckCircle2,
  ChevronRight,
  FileArchive,
  ArrowLeft,
} from 'lucide-react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { constructAcceptValue } from '@/lib/constants'
import { revalidateTags } from '@services/utils/ts/requests'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import {
  analyzeImportPackage,
  importCourses,
  ImportAnalysisResponse,
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

const SUPPORTED_FILES = constructAcceptValue(['zip'])

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
  const [importResult, setImportResult] = useState<ImportResultState | null>(null)

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
      <ImportStepIndicator steps={steps} currentStepIndex={currentStepIndex} />

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
            {uploadError && <ImportErrorMessage message={uploadError} />}

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
          <CourseSelectionList
            courses={courseSelections}
            onChange={handleCourseSelectionChange}
            onSelectAll={handleSelectAll}
            onDeselectAll={handleDeselectAll}
          />

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
      {step === 'importing' && <ImportingState />}

      {/* Complete Step */}
      {step === 'complete' && importResult && (
        <ImportResults result={importResult} onDone={handleComplete} />
      )}
    </div>
  )
}

export default LearnHouseCourseImport
