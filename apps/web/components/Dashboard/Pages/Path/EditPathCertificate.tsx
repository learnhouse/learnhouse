'use client'
import React, { useState } from 'react'
import { useFormik } from 'formik'
import { useTranslation } from 'react-i18next'
import { Award, Loader2, Save } from 'lucide-react'
import toast from 'react-hot-toast'
import CertificateDesigner, { CertificateDesignValues } from '@components/Objects/Certificates/CertificateDesigner'
import { Switch } from '@components/ui/switch'
import { Path, updatePath } from '@services/paths/paths'
import { getErrorMessage } from '@services/utils/ts/errorMessage'
import { usePathCache } from './usePathSave'

function EditPathCertificate({ path }: { path: Path }) {
  const { t } = useTranslation()
  const { accessToken, store } = usePathCache()
  const [isSaving, setIsSaving] = useState(false)
  const config = path.certificate_config || {}

  const formik = useFormik<CertificateDesignValues>({
    initialValues: {
      certification_name: config.certification_name || path.name,
      certification_description: config.certification_description || path.description || '',
      certification_type: config.certification_type || 'specialization',
      certificate_pattern: config.certificate_pattern || 'professional',
      certificate_instructor: config.certificate_instructor || '',
    },
    validate: (values) => {
      const errors: Partial<Record<keyof CertificateDesignValues, string>> = {}
      if (!values.certification_name.trim()) {
        errors.certification_name = t('dashboard.courses.certification.form.certification_name_required')
      } else if (values.certification_name.length > 100) {
        errors.certification_name = t('dashboard.courses.certification.form.certification_name_max_length')
      }
      if (values.certification_description.length > 500) {
        errors.certification_description = t('dashboard.courses.certification.form.certification_description_max_length')
      }
      return errors
    },
    enableReinitialize: true,
    onSubmit: async (values) => {
      setIsSaving(true)
      const toastId = toast.loading(t('paths.toasts.saving'))
      try {
        store(await updatePath(path.path_uuid, { certificate_config: values }, accessToken))
        toast.success(t('paths.toasts.saved'), { id: toastId })
      } catch (error: any) {
        toast.error(getErrorMessage(error?.detail, t('paths.toasts.save_error')), { id: toastId })
      } finally {
        setIsSaving(false)
      }
    },
  })

  const toggle = async (enabled: boolean) => {
    try {
      // First switch-on also stores the defaults, so the certificate a learner
      // gets matches the preview even if the author never presses save.
      const body = enabled && !path.certificate_config?.certification_name
        ? { certificate_enabled: true, certificate_config: formik.values }
        : { certificate_enabled: enabled }
      store(await updatePath(path.path_uuid, body, accessToken))
    } catch (error: any) {
      toast.error(getErrorMessage(error?.detail, t('paths.toasts.save_error')))
    }
  }

  return (
    <div className="px-4 sm:px-10 pt-6">
      <div className="bg-white rounded-xl shadow-sm px-4 py-4">
        <div className="flex items-center justify-between gap-4 bg-gray-50 px-3 sm:px-5 py-3 rounded-md mb-4">
          <div className="flex flex-col -space-y-1">
            <h2 className="font-bold text-lg sm:text-xl text-gray-800">{t('paths.dashboard.certificate.title')}</h2>
            <p className="text-gray-500 text-xs sm:text-sm">{t('paths.dashboard.certificate.subtitle')}</p>
          </div>
          <Switch checked={path.certificate_enabled} onCheckedChange={toggle} aria-label={t('paths.dashboard.certificate.title')} />
        </div>

        {path.certificate_enabled ? (
          <CertificateDesigner
            values={formik.values}
            errors={formik.errors}
            onChange={(field, value) => formik.setFieldValue(field, value)}
            footer={
              <div className="flex justify-end pt-4 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => formik.handleSubmit()}
                  disabled={isSaving || !formik.isValid}
                  className="inline-flex items-center px-4 py-2 text-sm font-medium text-white bg-black hover:bg-black/90 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSaving ? <Loader2 size={16} className="me-2 animate-spin" /> : <Save size={16} className="me-2" />}
                  {t('paths.form.save')}
                </button>
              </div>
            }
          />
        ) : (
          <div className="border border-dashed border-gray-200 rounded-lg px-6 py-12 text-center">
            <div className="w-12 h-12 rounded-full bg-gray-50 flex items-center justify-center mx-auto mb-3">
              <Award className="w-6 h-6 text-gray-400" />
            </div>
            <h3 className="font-semibold text-gray-800 mb-1">{t('paths.dashboard.certificate.disabled_title')}</h3>
            <p className="text-sm text-gray-500 mb-5 max-w-md mx-auto">{t('paths.dashboard.certificate.disabled_message')}</p>
            <button
              type="button"
              onClick={() => toggle(true)}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-black hover:bg-black/90 rounded-lg transition-colors"
            >
              <Award size={16} />
              {t('paths.dashboard.certificate.enable')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export default EditPathCertificate
