'use client'

import React from 'react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import { getUriWithOrg } from '@services/config/config'
import { Award } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { getAllUserCertificates } from '@services/courses/certifications'
import { asArray } from '@services/utils/ts/requests'
import { useTranslation } from 'react-i18next'
import CertificateCard from '@components/Objects/Certificates/CertificateCard'
import { useMyPathCertificates } from '@/hooks/queries/usePaths'
import { formatDate } from '@/lib/format'

interface UserCertificatesProps {
  orgslug: string
}

type Entry = {
  key: string
  href: string
  createdAt: string
  subtitle: string
  tag?: string
  certificate: React.ComponentProps<typeof CertificateCard>['certificate']
}

function SectionTitle({ count }: { count?: number }) {
  const { t } = useTranslation()
  return (
    <div className="flex items-center gap-3 mb-2">
      <div className="p-2 bg-white nice-shadow rounded-lg">
        <Award className="w-5 h-5 text-gray-900" />
      </div>
      <h2 className="text-lg font-bold text-gray-900">{t('certificate.my_certificates')}</h2>
      {!!count && (
        <span className="bg-gray-100 text-gray-700 text-xs font-medium px-2.5 py-0.5 rounded-full">{count}</span>
      )}
    </div>
  )
}

/** Every certificate the learner earned in this org, course and path
 * certificates together, newest first. */
const UserCertificates: React.FC<UserCertificatesProps> = ({ orgslug }) => {
  const { t, i18n } = useTranslation()
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const org = useOrg() as any
  const pathsEnabled = org?.config?.config?.resolved_features?.paths?.enabled === true
  const user = session?.data?.user
  const learnerName = [user?.first_name, user?.last_name].filter(Boolean).join(' ') || user?.username

  const { data: certificates, error, isLoading } = useQuery({
    queryKey: queryKeys.certifications.detail(`user_all_${org?.id}`),
    queryFn: () => getAllUserCertificates(org.id, access_token),
    select: (res: any) => asArray(res),
    enabled: !!access_token && !!org?.id,
    staleTime: 60_000,
  })
  const { data: pathCertificates } = useMyPathCertificates(pathsEnabled)

  const entries: Entry[] = [
    ...((certificates ?? []) as any[]).map((c) => {
      const config = c.certification?.config || {}
      return {
        key: c.certificate_user.user_certification_uuid,
        href: getUriWithOrg(orgslug, `/certificates/${c.certificate_user.user_certification_uuid}/verify`),
        createdAt: c.certificate_user.created_at,
        subtitle: c.course?.name,
        tag: t('certificate.kind_course'),
        certificate: {
          certificationName: config.certification_name || c.course?.name,
          certificationDescription: config.certification_description,
          certificationType: config.certification_type,
          certificatePattern: config.certificate_pattern,
          certificateInstructor: config.certificate_instructor,
          certificateId: c.certificate_user.user_certification_uuid,
          awardedDate: formatDate(c.certificate_user.created_at, i18n.language, { dateStyle: 'long' }),
          learnerName,
        },
      }
    }),
    ...(pathCertificates ?? [])
      .filter((c) => c.org.org_uuid === org?.org_uuid)
      .map((c) => {
        const config = c.path.certificate_config || {}
        return {
          key: c.certificate.certificate_uuid,
          href: getUriWithOrg(orgslug, `/paths/certificate/${c.certificate.certificate_uuid}`),
          createdAt: c.certificate.created_at,
          subtitle: c.path.name,
          tag: t('paths.path'),
          certificate: {
            certificationName: config.certification_name || c.path.name,
            certificationDescription: config.certification_description || c.path.description,
            certificationType: config.certification_type || 'specialization',
            certificatePattern: config.certificate_pattern,
            certificateInstructor: config.certificate_instructor,
            certificateId: c.certificate.certificate_uuid,
            awardedDate: formatDate(c.certificate.created_at, i18n.language, { dateStyle: 'long' }),
            learnerName,
          },
        }
      }),
  ].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))

  if (isLoading) {
    return (
      <div className="flex flex-col space-y-2">
        <SectionTitle />
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="bg-white rounded-xl nice-shadow overflow-hidden animate-pulse">
              <div className="aspect-[1123/794] bg-gray-100" />
              <div className="p-3 space-y-2">
                <div className="h-4 bg-gray-100 rounded w-3/4" />
                <div className="h-3 bg-gray-100 rounded w-1/2" />
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (error || entries.length === 0) {
    return (
      <div className="flex flex-col space-y-2">
        <SectionTitle />
        <div className="flex flex-col justify-center items-center py-12 px-4 border-2 border-dashed border-gray-100 rounded-2xl bg-gray-50/30">
          <div className="p-4 bg-white rounded-full nice-shadow mb-4">
            <Award className="w-8 h-8 text-gray-300" strokeWidth={1.5} />
          </div>
          {error ? (
            <p className="text-gray-500">{t('certificate.failed_load_certificates')}</p>
          ) : (
            <>
              <h3 className="text-xl font-bold text-gray-600 mb-2">{t('certificate.no_certificates_earned')}</h3>
              <p className="text-md text-gray-400 text-center max-w-xs">{t('certificate.complete_courses_to_earn')}</p>
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col space-y-2">
      <SectionTitle count={entries.length} />
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {entries.map((entry) => (
          <CertificateCard
            key={entry.key}
            href={entry.href}
            certificate={entry.certificate}
            subtitle={entry.subtitle}
            tag={entry.tag}
            date={entry.certificate.awardedDate as string}
          />
        ))}
      </div>
    </div>
  )
}

export default UserCertificates
