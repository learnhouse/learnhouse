'use client'

import React from 'react'
import { useOrg } from '@components/Contexts/OrgContext'
import { useCourses } from '@/hooks/queries/useCourses'
import { JsonLd } from '@components/SEO/JsonLd'
import { getUriWithOrg } from '@services/config/config'
import { getOrgLogoMediaDirectory } from '@services/media/media'
import AcyberLearningHome from '@components/Acyberschool/AcyberLearningHome'

export default function HomeClient({ orgslug }: { orgslug: string }) {
  const org = useOrg() as any
  const { data: courses, isLoading: coursesLoading } = useCourses(orgslug)

  const orgJsonLd = org
    ? {
        '@context': 'https://schema.org',
        '@type': 'Organization',
        name: org.name,
        description: org.description,
        url: getUriWithOrg(orgslug, '/'),
        ...(org.logo_image && {
          logo: getOrgLogoMediaDirectory(org.org_uuid, org.logo_image),
        }),
      }
    : null

  return (
    <div className="w-full">
      {orgJsonLd && <JsonLd data={orgJsonLd} />}
      <AcyberLearningHome
        orgslug={orgslug}
        courses={courses || []}
        isLoading={!org || coursesLoading}
      />
    </div>
  )
}
