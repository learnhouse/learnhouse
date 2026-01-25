'use client'
import React, { useState } from 'react'
import { Button } from '@components/ui/button'
import { Input } from '@components/ui/input'
import { Label } from '@components/ui/label'
import * as Form from '@radix-ui/react-form'
import BarLoader from 'react-spinners/BarLoader'
import { Upload, CheckCircle2, ChevronRight, AlertCircle, FileArchive, ArrowLeft } from 'lucide-react'
import { getAPIUrl } from '@services/config/config'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { constructAcceptValue } from '@/lib/constants'
import { revalidateTags } from '@services/utils/ts/requests'
import toast from 'react-hot-toast'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'

const SUPPORTED_FILES = constructAcceptValue(['zip'])

interface ScormScoInfo {
  identifier: string
  title: string
  launch_path: string
  prerequisites: string | null
}

interface ScormAnalysisResponse {
  temp_package_id: string
  scorm_version: string
  package_title: string
  scos: ScormScoInfo[]
}

interface ScoAssignment {
  scoIdentifier: string
  scoTitle: string
  activityName: string
  chapterName: string
  include: boolean
}

interface ScormCourseImportProps {
  orgId: number
  orgslug: string
  closeModal: () => void
}

function ScormCourseImport({ orgId, orgslug, closeModal }: ScormCourseImportProps) {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const router = useRouter()

  // Step state: 'upload' | 'configure'
  const [step, setStep] = useState<'upload' | 'configure'>('upload')

  // Upload step state
  const [scormFile, setScormFile] = useState<File | null>(null)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  // Analysis result state
  const [analysisResult, setAnalysisResult] = useState<ScormAnalysisResponse | null>(null)

  // Course configuration state
  const [courseName, setCourseName] = useState('')
  const [courseDescription, setCourseDescription] = useState('')

  // Assignment step state
  const [assignments, setAssignments] = useState<ScoAssignment[]>([])
  const [isImporting, setIsImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) {
      setScormFile(file)
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
      setScormFile(file)
      setUploadError(null)
    } else {
      setUploadError('Please upload a .zip file')
    }
  }

  const handleAnalyze = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!scormFile || !orgId) return

    setIsAnalyzing(true)
    setUploadError(null)

    try {
      const formData = new FormData()
      formData.append('scorm_file', scormFile)

      const response = await fetch(
        `${getAPIUrl()}scorm/analyze-for-import/${orgId}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${access_token}`,
          },
          body: formData,
        }
      )

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.detail || 'Failed to analyze SCORM package')
      }

      const result: ScormAnalysisResponse = await response.json()
      setAnalysisResult(result)

      // Set default course name from package title
      setCourseName(result.package_title || 'SCORM Course')

      // Initialize assignments - each SCO gets its own chapter by default
      setAssignments(
        result.scos.map((sco, index) => ({
          scoIdentifier: sco.identifier,
          scoTitle: sco.title,
          activityName: sco.title,
          chapterName: `Chapter ${index + 1}`,
          include: true,
        }))
      )

      setStep('configure')
    } catch (error: any) {
      setUploadError(error.message || 'Failed to analyze SCORM package')
    } finally {
      setIsAnalyzing(false)
    }
  }

  const handleAssignmentChange = (
    index: number,
    field: keyof ScoAssignment,
    value: string | boolean
  ) => {
    setAssignments((prev) =>
      prev.map((assignment, i) =>
        i === index ? { ...assignment, [field]: value } : assignment
      )
    )
  }

  const handleImport = async () => {
    if (!analysisResult || !orgId) return

    const selectedAssignments = assignments.filter((a) => a.include)
    if (selectedAssignments.length === 0) {
      setImportError('Please select at least one SCO to import')
      return
    }

    if (!courseName.trim()) {
      setImportError('Please enter a course name')
      return
    }

    setIsImporting(true)
    setImportError(null)

    try {
      const response = await fetch(
        `${getAPIUrl()}scorm/import-as-course`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${access_token}`,
          },
          body: JSON.stringify({
            org_id: orgId,
            temp_package_id: analysisResult.temp_package_id,
            course_name: courseName,
            course_description: courseDescription,
            sco_assignments: selectedAssignments.map((a) => ({
              sco_identifier: a.scoIdentifier,
              activity_name: a.activityName,
              chapter_name: a.chapterName,
            })),
          }),
        }
      )

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.detail || 'Failed to import SCORM package')
      }

      // Success
      await revalidateTags(['courses'], orgslug)
      toast.success(t('courses.course_created_success'))
      closeModal()
      router.refresh()
    } catch (error: any) {
      setImportError(error.message || 'Failed to import SCORM package')
    } finally {
      setIsImporting(false)
    }
  }

  const selectedCount = assignments.filter((a) => a.include).length

  const resetToUpload = () => {
    setStep('upload')
    setAnalysisResult(null)
    setAssignments([])
    setScormFile(null)
    setCourseName('')
    setCourseDescription('')
    setUploadError(null)
    setImportError(null)
  }

  return (
    <div className="min-w-[500px]">
      {/* Step Indicator */}
      <div className="flex items-center justify-center mb-6">
        <div className="flex items-center space-x-3">
          <div className={`flex items-center space-x-2 ${step === 'upload' ? 'text-black' : 'text-gray-400'}`}>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
              step === 'upload' ? 'bg-black text-white' : 'bg-green-500 text-white'
            }`}>
              {step === 'configure' ? <CheckCircle2 size={16} /> : '1'}
            </div>
            <span className="text-sm font-medium">{t('courses.scorm.upload_package')}</span>
          </div>
          <div className="w-12 h-[2px] bg-gray-200">
            <div className={`h-full transition-all duration-300 ${step === 'configure' ? 'w-full bg-green-500' : 'w-0'}`} />
          </div>
          <div className={`flex items-center space-x-2 ${step === 'configure' ? 'text-black' : 'text-gray-400'}`}>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
              step === 'configure' ? 'bg-black text-white' : 'bg-gray-200 text-gray-500'
            }`}>
              2
            </div>
            <span className="text-sm font-medium">{t('courses.scorm.configure')}</span>
          </div>
        </div>
      </div>

      {step === 'upload' && (
        <Form.Root onSubmit={handleAnalyze}>
          <div className="space-y-5">
            {/* File Upload Area */}
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`relative border-2 border-dashed rounded-xl p-8 text-center transition-all duration-200 ${
                isDragging
                  ? 'border-black bg-gray-50 scale-[1.02]'
                  : scormFile
                    ? 'border-green-300 bg-green-50'
                    : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
              }`}
            >
              <input
                id="scorm-file"
                type="file"
                accept={SUPPORTED_FILES}
                onChange={handleFileChange}
                className="hidden"
                required
              />
              <label
                htmlFor="scorm-file"
                className="cursor-pointer flex flex-col items-center space-y-3"
              >
                {scormFile ? (
                  <>
                    <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center">
                      <FileArchive size={28} className="text-green-600" />
                    </div>
                    <div className="space-y-1">
                      <p className="font-semibold text-gray-900">{scormFile.name}</p>
                      <p className="text-sm text-gray-500">
                        {(scormFile.size / 1024 / 1024).toFixed(2)} MB
                      </p>
                      <p className="text-xs text-green-600 font-medium">
                        {t('courses.scorm.ready_to_analyze')}
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center">
                      <Upload size={28} className="text-gray-400" />
                    </div>
                    <div className="space-y-1">
                      <p className="font-medium text-gray-700">{t('courses.scorm.click_to_upload')}</p>
                      <p className="text-sm text-gray-400">{t('courses.scorm.supported_versions')}</p>
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
              <p className="text-sm text-blue-700">{t('courses.scorm.import_info')}</p>
            </div>

            {/* Submit Button */}
            <div className="flex justify-end pt-2">
              <Button
                type="submit"
                disabled={!scormFile || isAnalyzing}
                className="bg-black text-white hover:bg-gray-800 px-6 h-11"
              >
                {isAnalyzing ? (
                  <div className="flex items-center space-x-2">
                    <BarLoader width={60} color="#ffffff" cssOverride={{ borderRadius: 60 }} />
                  </div>
                ) : (
                  <div className="flex items-center space-x-2">
                    <span>{t('courses.scorm.analyze_package')}</span>
                    <ChevronRight size={18} />
                  </div>
                )}
              </Button>
            </div>
          </div>
        </Form.Root>
      )}

      {step === 'configure' && analysisResult && (
        <div className="space-y-5">
          {/* Success Banner */}
          <div className="flex items-center justify-between p-3 bg-green-50 border border-green-100 rounded-lg">
            <div className="flex items-center space-x-2">
              <CheckCircle2 size={18} className="text-green-600" />
              <span className="text-sm font-medium text-green-800">{t('courses.scorm.package_analyzed')}</span>
            </div>
            <span className="text-xs font-medium text-green-700 bg-green-100 px-2 py-1 rounded-full">
              {analysisResult.scorm_version.replace('_', ' ').toUpperCase()}
            </span>
          </div>

          {/* Course Info Form */}
          <div className="space-y-4 p-4 bg-gray-50 rounded-lg border border-gray-100">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">{t('courses.scorm.course_details')}</h3>
            <div className="space-y-3">
              <div>
                <Label htmlFor="course-name" className="text-sm font-medium text-gray-700">
                  {t('courses.course_name')} <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="course-name"
                  value={courseName}
                  onChange={(e) => setCourseName(e.target.value)}
                  placeholder={t('courses.course_name')}
                  className="mt-1.5"
                />
              </div>
              <div>
                <Label htmlFor="course-description" className="text-sm font-medium text-gray-700">
                  {t('collections.description')}
                </Label>
                <Input
                  id="course-description"
                  value={courseDescription}
                  onChange={(e) => setCourseDescription(e.target.value)}
                  placeholder={t('collections.description')}
                  className="mt-1.5"
                />
              </div>
            </div>
          </div>

          {/* SCO Assignments */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-semibold text-gray-700">{t('courses.scorm.assign_scos')}</Label>
              <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded-full">
                {selectedCount} {t('common.of')} {assignments.length} {t('courses.scorm.selected')}
              </span>
            </div>
            <div className="space-y-2 max-h-[200px] overflow-y-auto pr-1">
              {assignments.map((assignment, index) => (
                <div
                  key={assignment.scoIdentifier}
                  className={`p-3 rounded-lg border transition-all duration-200 ${
                    assignment.include
                      ? 'border-gray-200 bg-white shadow-sm'
                      : 'border-gray-100 bg-gray-50 opacity-50'
                  }`}
                >
                  <div className="flex items-start space-x-3">
                    <input
                      type="checkbox"
                      checked={assignment.include}
                      onChange={(e) => handleAssignmentChange(index, 'include', e.target.checked)}
                      className="mt-0.5 w-4 h-4 rounded border-gray-300 text-black focus:ring-black focus:ring-offset-0"
                    />
                    <div className="flex-1 space-y-2">
                      <p className="text-sm font-medium text-gray-800">{assignment.scoTitle}</p>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-xs text-gray-500 block mb-1">{t('courses.scorm.activity_name')}</label>
                          <Input
                            value={assignment.activityName}
                            onChange={(e) => handleAssignmentChange(index, 'activityName', e.target.value)}
                            disabled={!assignment.include}
                            className="h-8 text-sm"
                            placeholder={t('courses.scorm.activity_name')}
                          />
                        </div>
                        <div>
                          <label className="text-xs text-gray-500 block mb-1">{t('courses.scorm.chapter_name')}</label>
                          <Input
                            value={assignment.chapterName}
                            onChange={(e) => handleAssignmentChange(index, 'chapterName', e.target.value)}
                            disabled={!assignment.include}
                            className="h-8 text-sm"
                            placeholder={t('courses.scorm.chapter_name')}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
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
              <span>{t('courses.scorm.upload_different')}</span>
            </button>
            <Button
              type="button"
              onClick={handleImport}
              disabled={selectedCount === 0 || isImporting || !courseName.trim()}
              className="bg-black text-white hover:bg-gray-800 px-6 h-11"
            >
              {isImporting ? (
                <BarLoader width={60} color="#ffffff" cssOverride={{ borderRadius: 60 }} />
              ) : (
                <div className="flex items-center space-x-2">
                  <span>{t('courses.scorm.create_course')}</span>
                  <ChevronRight size={18} />
                </div>
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

export default ScormCourseImport
