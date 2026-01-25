import React, { useState } from 'react'
import { Input } from '@components/ui/input'
import { Label } from '@components/ui/label'
import * as Form from '@radix-ui/react-form'
import BarLoader from 'react-spinners/BarLoader'
import { Upload, Package, CheckCircle2, ChevronRight, AlertCircle } from 'lucide-react'
import { getAPIUrl } from '@services/config/config'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { constructAcceptValue } from '@/lib/constants'
import { mutate } from 'swr'
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
  chapterId: string
  include: boolean
}

interface Chapter {
  id: number
  name: string
}

interface ScormActivityModalProps {
  course: any
  closeModal: () => void
  onImportComplete: () => void
}

function ScormActivityModal({ course, closeModal, onImportComplete }: ScormActivityModalProps) {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const router = useRouter()

  // Step state: 'upload' | 'assign'
  const [step, setStep] = useState<'upload' | 'assign'>('upload')

  // Upload step state
  const [scormFile, setScormFile] = useState<File | null>(null)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  // Analysis result state
  const [analysisResult, setAnalysisResult] = useState<ScormAnalysisResponse | null>(null)

  // Assignment step state
  const [assignments, setAssignments] = useState<ScoAssignment[]>([])
  const [isImporting, setIsImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)

  // Get course UUID - it's nested in courseStructure
  const courseUuid = course?.courseStructure?.course_uuid || course?.course_uuid

  // Get chapters from course
  const chapters: Chapter[] = course?.courseStructure?.chapters?.map((ch: any) => ({
    id: ch.id,
    name: ch.name,
  })) || course?.chapters?.map((ch: any) => ({
    id: ch.id,
    name: ch.name,
  })) || []

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) {
      setScormFile(file)
      setUploadError(null)
    }
  }

  const handleAnalyze = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!scormFile) return

    if (!courseUuid) {
      setUploadError('Course information is missing. Please try again.')
      return
    }

    setIsAnalyzing(true)
    setUploadError(null)

    try {
      const formData = new FormData()
      formData.append('scorm_file', scormFile)

      const response = await fetch(
        `${getAPIUrl()}scorm/analyze/${courseUuid}`,
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

      // Initialize assignments with default values
      const defaultChapterId = chapters.length > 0 ? chapters[0].id.toString() : ''
      setAssignments(
        result.scos.map((sco) => ({
          scoIdentifier: sco.identifier,
          scoTitle: sco.title,
          activityName: sco.title,
          chapterId: defaultChapterId,
          include: true,
        }))
      )

      setStep('assign')
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
    if (!analysisResult) return

    if (!courseUuid) {
      setImportError('Course information is missing. Please try again.')
      return
    }

    const selectedAssignments = assignments.filter((a) => a.include && a.chapterId)
    if (selectedAssignments.length === 0) {
      setImportError('Please select at least one SCO to import')
      return
    }

    setIsImporting(true)
    setImportError(null)

    try {
      const response = await fetch(
        `${getAPIUrl()}scorm/import/${courseUuid}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${access_token}`,
          },
          body: JSON.stringify({
            temp_package_id: analysisResult.temp_package_id,
            sco_assignments: selectedAssignments.map((a) => ({
              sco_identifier: a.scoIdentifier,
              chapter_id: parseInt(a.chapterId),
              activity_name: a.activityName,
            })),
          }),
        }
      )

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.detail || 'Failed to import SCORM package')
      }

      const importedActivities = await response.json()

      // Invalidate SWR cache and refresh data
      await mutate(`${getAPIUrl()}courses/meta/course_uuid/${courseUuid}`)

      // Show success toast
      toast.success(`Successfully imported ${importedActivities.length} SCORM ${importedActivities.length === 1 ? 'activity' : 'activities'}`)

      // Notify parent and close
      onImportComplete()
      closeModal()

      // Force router refresh to update the UI
      router.refresh()
    } catch (error: any) {
      setImportError(error.message || 'Failed to import SCORM package')
    } finally {
      setIsImporting(false)
    }
  }

  const selectedCount = assignments.filter((a) => a.include).length

  return (
    <div className="space-y-5">
      {step === 'upload' && (
        <Form.Root onSubmit={handleAnalyze} className="space-y-5">
          {/* Header */}
          <div className="flex items-center gap-3 pb-4 border-b border-gray-100">
            <div className="p-2.5 bg-sky-100 rounded-xl">
              <Package size={20} className="text-sky-600" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">
                {t('dashboard.courses.structure.activity.types.scorm')}
              </h3>
              <p className="text-sm text-gray-500">
                {t('dashboard.courses.structure.activity.descriptions.scorm')}
              </p>
            </div>
          </div>

          {/* File Upload */}
          <div className="space-y-2">
            <Label htmlFor="scorm-file" className="text-sm font-medium text-gray-700">SCORM Package (.zip)</Label>
            <div className={`
              border-2 border-dashed rounded-xl p-8 text-center transition-colors
              ${scormFile ? 'border-sky-300 bg-sky-50/50' : 'border-gray-200 bg-gray-50/50 hover:border-gray-300'}
            `}>
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
                className="cursor-pointer flex flex-col items-center gap-3"
              >
                {scormFile ? (
                  <>
                    <Package size={36} className="text-sky-500" />
                    <div>
                      <p className="font-medium text-gray-800">{scormFile.name}</p>
                      <p className="text-sm text-gray-500 mt-1">
                        {(scormFile.size / 1024 / 1024).toFixed(2)} MB
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <Upload size={36} className="text-gray-400" />
                    <div>
                      <p className="text-gray-600 font-medium">Click to upload or drag and drop</p>
                      <p className="text-sm text-gray-400 mt-1">SCORM 1.2 or SCORM 2004 package (max 200MB)</p>
                    </div>
                  </>
                )}
              </label>
            </div>
          </div>

          {/* Error Message */}
          {uploadError && (
            <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 p-3 rounded-xl border border-red-100">
              <AlertCircle size={16} />
              <span>{uploadError}</span>
            </div>
          )}

          {/* Info */}
          <div className="bg-sky-50 p-4 rounded-xl text-sm text-sky-700 border border-sky-100">
            <p>
              Upload your SCORM package to analyze its contents. You&apos;ll be able to assign each
              learning object to different chapters in the next step.
            </p>
          </div>

          {/* Submit Button */}
          <div className="flex justify-end pt-4 border-t border-gray-100">
            <button
              type="submit"
              disabled={!scormFile || isAnalyzing}
              className="inline-flex items-center justify-center gap-2 px-6 py-2.5 bg-black text-white text-sm font-semibold rounded-xl hover:bg-gray-800 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed min-w-[160px]"
            >
              {isAnalyzing ? (
                <BarLoader width={60} color="#ffffff" cssOverride={{ borderRadius: 60 }} />
              ) : (
                <>
                  <span>Analyze Package</span>
                  <ChevronRight size={16} />
                </>
              )}
            </button>
          </div>
        </Form.Root>
      )}

      {step === 'assign' && analysisResult && (
        <div className="space-y-5">
          {/* Header */}
          <div className="flex items-center justify-between pb-4 border-b border-gray-100">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-emerald-100 rounded-lg">
                <CheckCircle2 size={18} className="text-emerald-600" />
              </div>
              <span className="font-semibold text-gray-900">Package Analyzed Successfully</span>
            </div>
            <span className="text-xs font-medium text-gray-500 bg-gray-100 px-2.5 py-1 rounded-lg">
              {analysisResult.scorm_version.replace('_', ' ')}
            </span>
          </div>

          {/* Package Info */}
          <div className="bg-gray-50 p-4 rounded-xl border border-gray-100">
            <p className="text-sm text-gray-600">
              <span className="font-medium">Package:</span> {analysisResult.package_title}
            </p>
            <p className="text-sm text-gray-600 mt-1">
              <span className="font-medium">SCOs found:</span> {analysisResult.scos.length}
            </p>
          </div>

          {/* SCO Assignments */}
          <div className="space-y-3 max-h-[300px] overflow-y-auto">
            <Label className="text-sm font-medium text-gray-700">Assign SCOs to Chapters</Label>
            {assignments.map((assignment, index) => (
              <div
                key={assignment.scoIdentifier}
                className={`p-4 rounded-xl border transition-colors ${
                  assignment.include ? 'border-gray-200 bg-white' : 'border-gray-100 bg-gray-50 opacity-60'
                }`}
              >
                <div className="flex items-start gap-3">
                  {/* Include Checkbox */}
                  <input
                    type="checkbox"
                    checked={assignment.include}
                    onChange={(e) => handleAssignmentChange(index, 'include', e.target.checked)}
                    className="mt-1 rounded border-gray-300 text-black focus:ring-black h-4 w-4"
                  />

                  <div className="flex-1 space-y-3">
                    {/* SCO Title */}
                    <p className="text-sm font-medium text-gray-700">{assignment.scoTitle}</p>

                    {/* Activity Name Input */}
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-gray-500 w-16">Name:</label>
                      <Input
                        value={assignment.activityName}
                        onChange={(e) => handleAssignmentChange(index, 'activityName', e.target.value)}
                        disabled={!assignment.include}
                        className="h-9 text-sm"
                        placeholder="Activity name"
                      />
                    </div>

                    {/* Chapter Dropdown */}
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-gray-500 w-16">Chapter:</label>
                      <select
                        value={assignment.chapterId}
                        onChange={(e) => handleAssignmentChange(index, 'chapterId', e.target.value)}
                        disabled={!assignment.include}
                        className="flex-1 h-9 text-sm border border-gray-200 rounded-lg px-3 bg-white focus:outline-none focus:ring-2 focus:ring-black"
                      >
                        <option value="">Select chapter...</option>
                        {chapters.map((chapter) => (
                          <option key={chapter.id} value={chapter.id.toString()}>
                            {chapter.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Error Message */}
          {importError && (
            <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 p-3 rounded-xl border border-red-100">
              <AlertCircle size={16} />
              <span>{importError}</span>
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-between items-center pt-4 border-t border-gray-100">
            <button
              type="button"
              onClick={() => {
                setStep('upload')
                setAnalysisResult(null)
                setAssignments([])
                setScormFile(null)
              }}
              className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
            >
              &larr; Upload different package
            </button>

            <div className="flex items-center gap-4">
              <span className="text-sm text-gray-500">
                {selectedCount} of {assignments.length} selected
              </span>
              <button
                type="button"
                onClick={handleImport}
                disabled={selectedCount === 0 || isImporting}
                className="inline-flex items-center justify-center px-6 py-2.5 bg-black text-white text-sm font-semibold rounded-xl hover:bg-gray-800 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed min-w-[140px]"
              >
                {isImporting ? (
                  <BarLoader width={60} color="#ffffff" cssOverride={{ borderRadius: 60 }} />
                ) : (
                  `Import ${selectedCount} ${selectedCount === 1 ? 'Activity' : 'Activities'}`
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default ScormActivityModal
