'use client'
import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { removeCoursePrefix } from '@components/Objects/Thumbnails/CourseThumbnail'
import {
  CertificateCourseRow,
  CertificateNotFound,
  CertificateShowcase,
  CertificateShowcaseSkeleton,
  CertificateSubject,
} from '@components/Objects/Certificates/CertificateShowcase'
import { getAbsoluteUriWithOrg, getUriWithOrg } from '@services/config/config'
import { getPathCertificate, removePathPrefix } from '@services/paths/paths'
import { queryKeys } from '@/lib/query/keys'
import { formatDate } from '@/lib/format'

function PathCertificatePage({ orgslug, certificateUuid }: { orgslug: string; certificateUuid: string }) {
  const { t, i18n } = useTranslation()
  const session = useLHSession() as any
  const { data, isLoading, isError } = useQuery({
    queryKey: queryKeys.paths.certificate(certificateUuid),
    queryFn: () => getPathCertificate(certificateUuid),
    retry: false,
  })

  if (isLoading) return <CertificateShowcaseSkeleton />
  if (isError || !data) {
    return (
      <CertificateNotFound
        certificateUuid={certificateUuid}
        backHref={getUriWithOrg(orgslug, '/paths')}
        backLabel={t('paths.back_to_paths')}
      />
    )
  }

  const config = data.path.certificate_config || {}
  const learnerName = [data.user.first_name, data.user.last_name].filter(Boolean).join(' ') || data.user.username

  return (
    <CertificateShowcase
      certificate={{
        certificationName: config.certification_name || data.path.name,
        certificationDescription: config.certification_description || data.path.description,
        certificationType: config.certification_type || 'specialization',
        certificatePattern: config.certificate_pattern,
        certificateInstructor: config.certificate_instructor,
        certificateId: data.certificate.certificate_uuid,
        awardedDate: formatDate(data.certificate.created_at, i18n.language, { dateStyle: 'long' }),
        learnerName,
      }}
      issuerName={data.org.name}
      issuedAt={data.certificate.created_at}
      verifyLink={getAbsoluteUriWithOrg(orgslug, `/paths/certificate/${data.certificate.certificate_uuid}`)}
      isOwner={session?.data?.user?.user_uuid === data.user.user_uuid}
      subject={
        <CertificateSubject title={t('certificate.page.earned_for_path', { name: data.path.name })}>
          <div className="divide-y divide-gray-50">
            {data.path.courses.map((course) => (
              <CertificateCourseRow
                key={course.course_uuid}
                name={course.name}
                href={getUriWithOrg(orgslug, `/course/${removeCoursePrefix(course.course_uuid)}`)}
                tag={course.required ? undefined : t('paths.elective')}
              />
            ))}
          </div>
          <a
            href={getUriWithOrg(orgslug, `/path/${removePathPrefix(data.path.path_uuid)}`)}
            className="inline-block mt-3 text-sm font-medium text-gray-500 hover:text-gray-900"
          >
            {t('paths.view_path')} &rarr;
          </a>
        </CertificateSubject>
      }
    />
  )
}

export default PathCertificatePage
