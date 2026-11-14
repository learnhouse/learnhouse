'use client'
import React, { useState } from 'react'
import { useFormik } from 'formik'
import { useTranslation } from 'react-i18next'
import { Medal, CircleNotch, FloppyDisk } from '@phosphor-icons/react'
import toast from 'react-hot-toast'
import CertificateDesigner, { CertificateDesignValues } from '@components/Objects/Certificates/CertificateDesigner'
import { Switch } from '@components/ui/switch'
import { BTN_PRIMARY, SectionCard } from '@components/Dashboard/Shared/DashKit/DashKit'
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
      <SectionCard
        icon={<Medal size={16} />}
        title={t('paths.dashboard.certificate.title')}
        description={t('paths.dashboard.certificate.subtitle')}
        actions={
          <Switch checked={path.certificate_enabled} onCheckedChange={toggle} aria-label={t('paths.dashboard.certificate.title')} />
        }
      >
        {path.certificate_enabled ? (
          <CertificateDesigner
            values={formik.values}
            errors={formik.errors}
            onChange={(field, value) => formik.setFieldValue(field, value)}
            footer={
              <div className="flex justify-end pt-4 border-t border-neutral-100">
                <button
                  type="button"
                  onClick={() => formik.handleSubmit()}
                  disabled={isSaving || !formik.isValid}
                  className={BTN_PRIMARY}
                >
                  {isSaving ? <CircleNotch size={16} className="animate-spin" /> : <FloppyDisk size={16} />}
                  {t('paths.form.save')}
                </button>
              </div>
            }
          />
        ) : (
          <div className="relative overflow-hidden rounded-2xl bg-gradient-to-b from-amber-50/70 to-white ring-1 ring-inset ring-amber-100/80 px-6 py-14 text-center">
            <div className="relative mx-auto mb-4 w-14 h-14">
              <div className="absolute inset-0 rounded-2xl bg-amber-200/50 rotate-6" />
              <div className="relative w-14 h-14 rounded-2xl bg-white nice-shadow text-amber-500 flex items-center justify-center">
                <Medal size={26} />
              </div>
            </div>
            <h3 className="text-base font-semibold text-neutral-900">{t('paths.dashboard.certificate.disabled_title')}</h3>
            <p className="mt-1 text-sm text-neutral-500 max-w-md mx-auto">{t('paths.dashboard.certificate.disabled_message')}</p>
            <button type="button" onClick={() => toggle(true)} className={`${BTN_PRIMARY} mt-5`}>
              <Medal size={16} />
              {t('paths.dashboard.certificate.enable')}
            </button>
          </div>
        )}
      </SectionCard>
    </div>
  )
}

export default EditPathCertificate
