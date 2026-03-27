'use client'
import React, { useState } from 'react'
import {
  Sparkles,
  LayoutGrid,
  Loader2,
  BookCopy,
  Upload,
  CheckCircle2,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import { getUriWithOrg } from '@services/config/config'
import { Breadcrumbs } from '@components/Objects/Breadcrumbs/Breadcrumbs'
import MigrationDropZone from '@components/Objects/Modals/Course/Create/MigrationWizard/MigrationDropZone'
import MigrationPromptForm from '@components/Objects/Modals/Course/Create/MigrationWizard/MigrationPromptForm'
import MigrationTreeEditor from '@components/Objects/Modals/Course/Create/MigrationWizard/MigrationTreeEditor'
import MigrationProgress from '@components/Objects/Modals/Course/Create/MigrationWizard/MigrationProgress'
import {
  uploadMigrationFiles,
  suggestStructure,
  createFromMigration,
  MigrationTreeStructure,
  UploadedFileInfo,
  MigrationCreateResult,
} from '@services/courses/migration'
import toast from 'react-hot-toast'

type WizardStep = 'upload' | 'organize' | 'creating' | 'complete'

interface MigrationClientProps {
  orgslug: string
}

export default function MigrationClient({ orgslug }: MigrationClientProps) {
  const { t } = useTranslation()
  const router = useRouter()
  const session = useLHSession() as any
  const org = useOrg() as any
  const access_token = session?.data?.tokens?.access_token
  const org_id = org?.id

  const canUseAI =
    org?.config?.config?.resolved_features?.ai?.enabled === true

  // Upload state
  const [files, setFiles] = useState<File[]>([])
  const [courseName, setCourseName] = useState('')
  const [description, setDescription] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState('')

  // Organization state
  const [step, setStep] = useState<WizardStep>('upload')
  const [tempId, setTempId] = useState('')
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFileInfo[]>([])
  const [structure, setStructure] =
    useState<MigrationTreeStructure | null>(null)
  const [aiLoading, setAiLoading] = useState(false)

  // Creation state
  const [createStatus, setCreateStatus] = useState<
    'creating' | 'success' | 'error'
  >('creating')
  const [createResult, setCreateResult] = useState<
    MigrationCreateResult | undefined
  >()

  const handleUploadAndOrganize = async (useAI: boolean) => {
    if (!files.length || !courseName.trim() || !access_token || !org_id)
      return

    setUploading(true)
    try {
      const uploadResult = await uploadMigrationFiles(
        files,
        org_id,
        access_token,
        (uploaded, total, currentFile) => {
          setUploadProgress(
            `${t('migration.uploading_files')} ${uploaded}/${total}${currentFile ? ` — ${currentFile}` : ''}`
          )
        }
      )
      setTempId(uploadResult.temp_id)
      setUploadedFiles(uploadResult.files)

      if (useAI) {
        setAiLoading(true)
        try {
          const suggested = await suggestStructure(
            uploadResult.temp_id,
            courseName,
            description || undefined,
            org_id,
            access_token
          )
          setStructure(suggested)
        } catch {
          toast.error(t('migration.ai_failed'))
          setStructure({
            course_name: courseName,
            course_description: description || undefined,
            chapters: [
              { name: t('migration.new_chapter'), activities: [] },
            ],
          })
        } finally {
          setAiLoading(false)
        }
      } else {
        setStructure({
          course_name: courseName,
          course_description: description || undefined,
          chapters: [
            { name: t('migration.new_chapter'), activities: [] },
          ],
        })
      }

      setStep('organize')
    } catch (err: any) {
      toast.error(err.message || t('migration.upload_failed'))
    } finally {
      setUploading(false)
    }
  }

  const handleCreate = async () => {
    if (!structure || !tempId || !access_token || !org_id) return

    setStep('creating')
    setCreateStatus('creating')

    try {
      const result = await createFromMigration(
        tempId,
        structure,
        org_id,
        access_token
      )
      if (result.success) {
        setCreateStatus('success')
        setCreateResult(result)
        setStep('complete')
      } else {
        setCreateStatus('error')
        setCreateResult(result)
      }
    } catch (err: any) {
      setCreateStatus('error')
      setCreateResult({
        course_uuid: '',
        course_name: structure.course_name,
        chapters_created: 0,
        activities_created: 0,
        success: false,
        error: err.message,
      })
    }
  }

  const handleGoToCourse = () => {
    if (createResult?.course_uuid) {
      const bareUuid = createResult.course_uuid.replace('course_', '')
      router.push(
        getUriWithOrg(
          orgslug,
          `/dash/courses/course/${bareUuid}/content`
        )
      )
    }
  }

  const handleRetry = () => {
    setStep('organize')
    setCreateStatus('creating')
    setCreateResult(undefined)
  }

  const canProceedToUpload =
    files.length > 0 && courseName.trim().length > 0

  // Step indicator
  const steps = [
    { key: 'upload', label: t('migration.step_upload') },
    { key: 'organize', label: t('migration.step_organize') },
    { key: 'complete', label: t('migration.step_complete') },
  ]

  const currentStepIndex =
    step === 'creating'
      ? 2
      : steps.findIndex((s) => s.key === step)

  return (
    <div className="h-full w-full bg-[#f8f8f8] pl-10 pr-10">
      <div className="mb-6 pt-6">
        <Breadcrumbs
          items={[
            {
              label: t('courses.courses'),
              href: '/dash/courses',
              icon: <BookCopy size={14} />,
            },
            {
              label: t('migration.title'),
              icon: <Upload size={14} />,
            },
          ]}
        />
        <h1 className="text-3xl font-bold mt-4">
          {t('migration.title')}
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          {t('migration.subtitle')}
        </p>
      </div>

      {/* Step Indicator */}
      <div className="flex items-center justify-center mb-8">
        <div className="flex items-center space-x-3">
          {steps.map((s, index) => (
            <React.Fragment key={s.key}>
              {index > 0 && (
                <div className="w-12 h-[2px] bg-gray-200">
                  <div
                    className={`h-full transition-all duration-300 ${
                      index <= currentStepIndex
                        ? 'w-full bg-green-500'
                        : 'w-0'
                    }`}
                  />
                </div>
              )}
              <div
                className={`flex items-center space-x-2 ${
                  index === currentStepIndex
                    ? 'text-black'
                    : index < currentStepIndex
                      ? 'text-green-600'
                      : 'text-gray-400'
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
                  {index < currentStepIndex ? (
                    <CheckCircle2 size={16} />
                  ) : (
                    index + 1
                  )}
                </div>
                <span className="text-sm font-medium hidden sm:inline">
                  {s.label}
                </span>
              </div>
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* Step: Upload */}
      {step === 'upload' && (
        <div className="max-w-2xl mx-auto">
          <div className="bg-white rounded-xl nice-shadow p-6 space-y-5">
            <MigrationDropZone
              files={files}
              onFilesChange={setFiles}
              uploading={uploading}
            />

            {files.length > 0 && (
              <>
                <div className="border-t border-gray-100 pt-5">
                  <MigrationPromptForm
                    courseName={courseName}
                    onCourseNameChange={setCourseName}
                    description={description}
                    onDescriptionChange={setDescription}
                    disabled={uploading}
                  />
                </div>

                {uploading && uploadProgress && (
                  <p className="text-xs text-gray-500 text-center">{uploadProgress}</p>
                )}

                <div className="flex items-center space-x-3 justify-end pt-2">
                  {canUseAI && (
                    <button
                      onClick={() => handleUploadAndOrganize(true)}
                      disabled={!canProceedToUpload || uploading}
                      className={`rounded-lg bg-black transition-all duration-100 ease-linear antialiased p-2 px-5 text-xs font-bold text-white nice-shadow flex space-x-2 items-center ${
                        !canProceedToUpload || uploading
                          ? 'opacity-50 cursor-not-allowed'
                          : 'hover:scale-105'
                      }`}
                    >
                      {uploading || aiLoading ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <Sparkles size={14} />
                      )}
                      <span>{t('migration.organize_with_ai')}</span>
                    </button>
                  )}
                  <button
                    onClick={() => handleUploadAndOrganize(false)}
                    disabled={!canProceedToUpload || uploading}
                    className={`rounded-lg border border-gray-200 bg-white transition-all duration-100 ease-linear antialiased p-2 px-5 text-xs font-bold text-gray-700 nice-shadow flex space-x-2 items-center ${
                      !canProceedToUpload || uploading
                        ? 'opacity-50 cursor-not-allowed'
                        : 'hover:scale-105'
                    }`}
                  >
                    {uploading && !aiLoading ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <LayoutGrid size={14} />
                    )}
                    <span>{t('migration.organize_manually')}</span>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Step: Organize */}
      {step === 'organize' && structure && (
        <div>
          <div className="h-[calc(100vh-320px)]">
            <MigrationTreeEditor
              structure={structure}
              onStructureChange={setStructure}
              files={uploadedFiles}
            />
          </div>
          <div className="flex justify-end mt-4">
            <button
              onClick={handleCreate}
              className="rounded-lg bg-black transition-all duration-100 ease-linear antialiased p-2 px-5 text-xs font-bold text-white nice-shadow flex space-x-2 items-center hover:scale-105"
            >
              <span>{t('migration.create_course')}</span>
            </button>
          </div>
        </div>
      )}

      {/* Step: Creating / Complete */}
      {(step === 'creating' || step === 'complete') && (
        <div className="max-w-md mx-auto">
          <div className="bg-white rounded-xl nice-shadow p-8">
            <MigrationProgress
              status={createStatus}
              result={createResult}
              onGoToCourse={handleGoToCourse}
              onRetry={handleRetry}
            />
          </div>
        </div>
      )}
    </div>
  )
}
