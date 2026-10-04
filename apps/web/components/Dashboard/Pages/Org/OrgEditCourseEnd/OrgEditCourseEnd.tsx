'use client'
import React, { useState, useEffect } from 'react'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { toast } from 'react-hot-toast'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { revalidateTags } from '@services/utils/ts/requests'
import { updateOrgCourseEndConfig } from '@services/settings/org'
import { useTranslation } from 'react-i18next'
import { Input } from '@components/ui/input'
import { Textarea } from '@components/ui/textarea'
import { Label } from '@components/ui/label'
import { FloppyDisk, Trophy, ArrowLeft, ArrowRight } from '@phosphor-icons/react'
import { getCourseEndConfig, resolveCourseEndButton } from '@components/Pages/Activity/courseEndConfig'

const MESSAGE_MAX = 500
const BUTTON_TEXT_MAX = 60

const OrgEditCourseEnd: React.FC = () => {
  const { t } = useTranslation()
  const org = useOrg() as any
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const queryClient = useQueryClient()

  const [message, setMessage] = useState('')
  const [buttonText, setButtonText] = useState('')
  const [buttonLink, setButtonLink] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const config = getCourseEndConfig(org)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMessage(config.message || '')
    setButtonText(config.button_text || '')
    setButtonLink(config.button_link || '')
  }, [org])

  const trimmedLink = buttonLink.trim()
  const linkInvalid =
    trimmedLink !== '' &&
    !/^https?:\/\//i.test(trimmedLink) &&
    !(trimmedLink.startsWith('/') && !trimmedLink.startsWith('//'))

  const preview = resolveCourseEndButton({ button_text: buttonText, button_link: buttonLink })

  const save = async () => {
    if (linkInvalid) {
      toast.error(t('dashboard.organization.course_end.link_invalid'))
      return
    }
    setSaving(true)
    const tid = toast.loading(t('dashboard.organization.course_end.saving'))
    try {
      await updateOrgCourseEndConfig(
        String(org.id),
        { message, button_text: buttonText, button_link: buttonLink },
        access_token
      )
      await revalidateTags(['organizations'], org.slug)
      queryClient.invalidateQueries({ queryKey: queryKeys.org.detail(org.slug) })
      toast.success(t('dashboard.organization.course_end.saved'), { id: tid })
    } catch (e: any) {
      toast.error(e?.message || t('dashboard.organization.course_end.error'), { id: tid })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="sm:mx-10 mx-0 bg-white rounded-xl nice-shadow">
      <div className="pt-0.5">
        <div className="flex items-center justify-between bg-gray-50 px-5 py-3 mx-3 my-3 rounded-md">
          <div className="flex flex-col -space-y-1">
            <h1 className="font-bold text-xl text-gray-800">{t('dashboard.organization.course_end.title')}</h1>
            <h2 className="text-gray-500 text-md">{t('dashboard.organization.course_end.subtitle')}</h2>
          </div>
          <button
            onClick={save}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white nice-shadow hover:bg-neutral-800 transition-colors disabled:opacity-40"
          >
            <FloppyDisk size={16} weight="bold" />
            <span>{t('dashboard.organization.course_end.save')}</span>
          </button>
        </div>
      </div>

      <div className="p-4 pt-1 grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-4">
          <div>
            <Label htmlFor="course-end-message">{t('dashboard.organization.course_end.message_label')}</Label>
            <Textarea
              id="course-end-message"
              value={message}
              maxLength={MESSAGE_MAX}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={t('certificate.dedication_message')}
              className="min-h-[100px]"
            />
            <p className="text-xs text-gray-500 mt-1">{t('dashboard.organization.course_end.message_help')}</p>
          </div>

          <div>
            <Label htmlFor="course-end-button-text">{t('dashboard.organization.course_end.button_text_label')}</Label>
            <Input
              id="course-end-button-text"
              value={buttonText}
              maxLength={BUTTON_TEXT_MAX}
              onChange={(e) => setButtonText(e.target.value)}
              placeholder={t('courses.browse_all_courses')}
            />
          </div>

          <div>
            <Label htmlFor="course-end-button-link">{t('dashboard.organization.course_end.button_link_label')}</Label>
            <Input
              id="course-end-button-link"
              value={buttonLink}
              onChange={(e) => setButtonLink(e.target.value)}
              placeholder="/courses"
              aria-invalid={linkInvalid}
            />
            <p className={`text-xs mt-1 ${linkInvalid ? 'text-red-600' : 'text-gray-500'}`}>
              {linkInvalid
                ? t('dashboard.organization.course_end.link_invalid')
                : t('dashboard.organization.course_end.button_link_help')}
            </p>
          </div>
        </div>

        {/* Preview */}
        <div>
          <p className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wider">{t('dashboard.organization.course_end.preview')}</p>
          <div className="bg-gray-50 rounded-xl p-6 text-center space-y-4 border border-gray-100">
            <div className="flex justify-center">
              <div className="bg-emerald-100 p-3 rounded-full">
                <Trophy size={32} weight="fill" className="text-emerald-600" />
              </div>
            </div>
            <div className="text-2xl font-bold text-gray-900">{t('courses.congratulations')}</div>
            <p className="text-sm text-gray-500 whitespace-pre-line">
              {message.trim() || t('certificate.dedication_message')}
            </p>
            <div className="flex flex-wrap justify-center gap-2 pt-2">
              <span className="inline-flex items-center gap-2 bg-gray-800 text-white text-sm px-4 py-2 rounded-full">
                <ArrowLeft size={14} weight="bold" />
                {t('courses.back_to_course')}
              </span>
              <span className="inline-flex items-center gap-2 bg-white text-gray-800 border border-gray-300 text-sm px-4 py-2 rounded-full">
                {preview.text || t('courses.browse_all_courses')}
                <ArrowRight size={14} weight="bold" />
              </span>
            </div>
            <p className="text-xs text-gray-400 truncate">{preview.href}</p>
          </div>
        </div>
      </div>
    </div>
  )
}

export default OrgEditCourseEnd
