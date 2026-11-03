'use client'
import React from 'react'
import * as Form from '@radix-ui/react-form'
import { useTranslation } from 'react-i18next'
import { Check } from 'lucide-react'
import { FormField, FormLabelAndMessage, Input, Textarea } from '@components/Objects/StyledElements/Form/Form'
import {
  CustomSelect,
  CustomSelectContent,
  CustomSelectItem,
  CustomSelectTrigger,
  CustomSelectValue,
} from '@components/Dashboard/Pages/Course/EditCourseGeneral/CustomSelect'
import CertificatePreview from '@components/Dashboard/Pages/Course/EditCourseCertification/CertificatePreview'
import { CERTIFICATE_PATTERN_KEYS, getCertificateStyle } from '@components/Objects/Certificates/CertificateArtwork'

export const CERTIFICATE_TYPES = [
  'completion', 'achievement', 'assessment', 'participation', 'mastery',
  'professional', 'continuing', 'workshop', 'specialization',
]

export interface CertificateDesignValues {
  certification_name: string
  certification_description: string
  certification_type: string
  certificate_pattern: string
  certificate_instructor: string
}

/** A miniature of a style's frame, for the picker. */
function StyleSwatch({ pattern }: { pattern: string }) {
  const { accent, frame } = getCertificateStyle(pattern)
  const ring = frame === 'hairline' || frame === 'bar' || frame === 'brackets' ? '#e5e7eb' : accent
  return (
    <div className="relative w-full aspect-[1123/794] bg-white rounded-[3px] shadow-sm ring-1 ring-black/5">
      <div
        className="absolute inset-[7%]"
        style={{ border: `1px solid ${ring}`, borderRadius: frame === 'rounded' ? 4 : 0 }}
      />
      {frame === 'double' && <div className="absolute inset-[12%]" style={{ border: `1px solid ${accent}`, opacity: 0.4 }} />}
      {frame === 'bar' && <div className="absolute top-[7%] bottom-[7%] start-[7%] w-[3px]" style={{ background: accent }} />}
      {frame === 'brackets' &&
        ['top-[7%] start-[7%] border-t border-s', 'top-[7%] end-[7%] border-t border-e', 'bottom-[7%] start-[7%] border-b border-s', 'bottom-[7%] end-[7%] border-b border-e'].map((pos) => (
          <div key={pos} className={`absolute w-[16%] h-[22%] ${pos}`} style={{ borderColor: accent }} />
        ))}
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-[6%]">
        <div className="h-[5%] w-[34%] rounded-full" style={{ background: accent, opacity: 0.85 }} />
        <div className="h-[4%] w-[52%] rounded-full bg-gray-200" />
        <div className="h-[4%] w-[40%] rounded-full bg-gray-100" />
      </div>
    </div>
  )
}

/**
 * Form + live preview for a certificate's design. Shared by the course
 * certification tab and the path certificate tab so both read and look the
 * same; each owns how it saves.
 */
function CertificateDesigner({
  values,
  errors = {},
  onChange,
  footer,
}: {
  values: CertificateDesignValues
  errors?: Partial<Record<keyof CertificateDesignValues, string>>
  onChange: (field: keyof CertificateDesignValues, value: string) => void
  footer?: React.ReactNode
}) {
  const { t } = useTranslation()

  return (
    <div className="grid grid-cols-1 xl:grid-cols-5 gap-6 items-start">
      <Form.Root className="xl:col-span-2 space-y-5" onSubmit={(e) => e.preventDefault()}>
        <FormField name="certification_name">
          <FormLabelAndMessage
            label={t('dashboard.courses.certification.form.certification_name_label')}
            message={errors.certification_name}
          />
          <Form.Control asChild>
            <Input
              value={values.certification_name}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange('certification_name', e.target.value)}
              type="text"
            />
          </Form.Control>
        </FormField>

        <FormField name="certification_description">
          <FormLabelAndMessage
            label={t('dashboard.courses.certification.form.certification_description_label')}
            message={errors.certification_description}
          />
          <Form.Control asChild>
            <Textarea
              rows={3}
              value={values.certification_description}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => onChange('certification_description', e.target.value)}
            />
          </Form.Control>
        </FormField>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2 gap-5">
          <FormField name="certification_type">
            <FormLabelAndMessage label={t('dashboard.courses.certification.form.certification_type_label')} />
            <CustomSelect value={values.certification_type} onValueChange={(value) => value && onChange('certification_type', value)}>
              <CustomSelectTrigger className="w-full bg-white">
                <CustomSelectValue>{t(`dashboard.courses.certification.types.${values.certification_type || 'completion'}`)}</CustomSelectValue>
              </CustomSelectTrigger>
              <CustomSelectContent>
                {CERTIFICATE_TYPES.map((type) => (
                  <CustomSelectItem key={type} value={type}>
                    {t(`dashboard.courses.certification.types.${type}`)}
                  </CustomSelectItem>
                ))}
              </CustomSelectContent>
            </CustomSelect>
          </FormField>

          <FormField name="certificate_instructor">
            <FormLabelAndMessage label={t('certificate.designer.signer')} />
            <Form.Control asChild>
              <Input
                value={values.certificate_instructor}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange('certificate_instructor', e.target.value)}
                placeholder={t('certificate.designer.signer_placeholder')}
                type="text"
              />
            </Form.Control>
          </FormField>
        </div>

        <div>
          <div className="text-sm font-medium text-gray-700 mb-2">{t('certificate.designer.style')}</div>
          <div role="radiogroup" aria-label={t('certificate.designer.style')} className="grid grid-cols-5 gap-2.5">
            {CERTIFICATE_PATTERN_KEYS.map((pattern) => {
              const selected = (values.certificate_pattern || 'professional') === pattern
              return (
                <button
                  key={pattern}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={t(`dashboard.courses.certification.patterns.${pattern}.name`)}
                  onClick={() => onChange('certificate_pattern', pattern)}
                  className={`group relative rounded-md p-1.5 transition-colors ${selected ? 'bg-gray-100 ring-2 ring-black' : 'bg-gray-50 hover:bg-gray-100'}`}
                >
                  <StyleSwatch pattern={pattern} />
                  <span className="block mt-1.5 text-[11px] font-medium text-gray-600 truncate">
                    {t(`dashboard.courses.certification.patterns.${pattern}.name`)}
                  </span>
                  {selected && (
                    <span className="absolute -top-1.5 -end-1.5 w-4 h-4 rounded-full bg-black text-white flex items-center justify-center">
                      <Check size={10} strokeWidth={3} />
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>

        {footer}
      </Form.Root>

      <div className="xl:col-span-3 xl:sticky xl:top-6">
        <div className="bg-gray-50 rounded-xl p-4 sm:p-6">
          <div className="rounded-sm overflow-hidden shadow-sm ring-1 ring-black/5">
            <CertificatePreview
              certificationName={values.certification_name}
              certificationDescription={values.certification_description}
              certificationType={values.certification_type}
              certificatePattern={values.certificate_pattern}
              certificateInstructor={values.certificate_instructor}
            />
          </div>
          <p className="text-xs text-gray-500 mt-3 text-center">{t('certificate.designer.preview_hint')}</p>
        </div>
      </div>
    </div>
  )
}

export default CertificateDesigner
