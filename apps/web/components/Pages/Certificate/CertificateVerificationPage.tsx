'use client'
import React from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ChevronRight } from 'lucide-react'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import {
  CertificateNotFound,
  CertificateShowcase,
  CertificateShowcaseSkeleton,
  CertificateSubject,
} from '@components/Objects/Certificates/CertificateShowcase'
import { getCertificateByUuid } from '@services/courses/certifications'
import { getAbsoluteUriWithOrg, getUriWithOrg } from '@services/config/config'
import { getCourseThumbnailMediaDirectory } from '@services/media/media'
import ThumbnailImage from '@components/Objects/Thumbnails/ThumbnailImage'
import { useTrackView, AnalyticsEvent } from '@services/analytics'
import { formatDate } from '@/lib/format'
import { coursePath } from '@/lib/seo/paths'
import { useContentLanguage } from '@/hooks/useContentLanguage'

function CertificateVerificationPage({ certificateUuid }: { certificateUuid: string }) {
  const { t, i18n } = useTranslation()
  const org = useOrg() as any
  const session = useLHSession() as any
  const orgslug = org?.slug || ''

  // Course name in the viewer's content language when a translation is published.
  const contentLang = useContentLanguage()
  const { data, isLoading } = useQuery({
    queryKey: ['certificate', 'verify', certificateUuid, org?.id, contentLang.lang],
    queryFn: () => getCertificateByUuid(certificateUuid, org.id, contentLang.lang || undefined),
    enabled: !!org?.id && contentLang.ready,
    retry: false,
  })
  const record = data?.success ? data.data : null

  useTrackView(
    AnalyticsEvent.CertificateVerificationViewed,
    { verification_status: record ? 'valid' : 'invalid' },
    !isLoading && !!org?.id,
  )
  // The org analytics count of certificate views, which only covers real ones.
  useTrackView(
    AnalyticsEvent.CertificateViewed,
    { certificate_uuid: record?.certificate_user?.user_certification_uuid, source: 'verification' },
    !!record,
  )

  if (isLoading || !org?.id) return <CertificateShowcaseSkeleton />
  if (!record) {
    return (
      <CertificateNotFound
        certificateUuid={certificateUuid}
        backHref={getUriWithOrg(orgslug, '/')}
        backLabel={t('certificate.page.go_home')}
      />
    )
  }

  const config = record.certification?.config || {}
  const holder = record.user || {}
  const learnerName = [holder.first_name, holder.last_name].map((part) => part?.trim()).filter(Boolean).join(' ') || holder.username || ''
  const course = record.course
  const courseHref = getUriWithOrg(orgslug, coursePath(course))

  return (
    <CertificateShowcase
      certificate={{
        certificationName: config.certification_name || course.name,
        certificationDescription: config.certification_description,
        certificationType: config.certification_type,
        certificatePattern: config.certificate_pattern,
        certificateInstructor: config.certificate_instructor,
        certificateId: record.certificate_user.user_certification_uuid,
        awardedDate: formatDate(record.certificate_user.created_at, i18n.language, { dateStyle: 'long' }),
        learnerName,
      }}
      issuerName={org.name}
      issuedAt={record.certificate_user.created_at}
      verifyLink={getAbsoluteUriWithOrg(orgslug, `/certificates/${record.certificate_user.user_certification_uuid}/verify`)}
      isOwner={!!holder.user_uuid && session?.data?.user?.user_uuid === holder.user_uuid}
      subject={
        <CertificateSubject title={t('certificate.page.earned_for_course')}>
          <Link href={courseHref} className="group flex items-center gap-4 -m-2 p-2 rounded-lg hover:bg-gray-50">
            <ThumbnailImage
              src={
                course.thumbnail_image
                  ? getCourseThumbnailMediaDirectory(org.org_uuid, course.course_uuid, course.thumbnail_image)
                  : null
              }
              className="w-28 aspect-video rounded-md bg-gray-100 ring-1 ring-black/5 shrink-0"
            />
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-gray-900 max-sm:line-clamp-2 sm:truncate" dir="auto">{course.name}</div>
              {course.description && (
                <p className="text-sm text-gray-500 line-clamp-2" dir="auto">{course.description}</p>
              )}
            </div>
            <ChevronRight size={18} className="text-gray-300 group-hover:text-gray-500 rtl:rotate-180 shrink-0" />
          </Link>
        </CertificateSubject>
      }
    />
  )
}

export default CertificateVerificationPage
