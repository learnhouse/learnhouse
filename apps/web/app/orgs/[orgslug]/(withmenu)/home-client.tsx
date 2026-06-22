'use client'
import React from 'react'
import { useOrg } from '@components/Contexts/OrgContext'
import { useCourses } from '@/hooks/queries/useCourses'
import LandingClassic from '@components/Landings/LandingClassic'
import LandingCustom from '@components/Landings/LandingCustom'
import { JsonLd } from '@components/SEO/JsonLd'
import { getUriWithOrg } from '@services/config/config'
import { getOrgLogoMediaDirectory } from '@services/media/media'
import GeneralWrapperStyled from '@components/Objects/StyledElements/Wrappers/GeneralWrapper'

export default function HomeClient({ orgslug }: { orgslug: string }) {
  const org = useOrg() as any
  const { data: courses, isLoading: coursesLoading } = useCourses(orgslug)

  const landingConfig = org?.config?.config?.customization?.landing || org?.config?.config?.landing
  const hasCustomLanding = landingConfig?.enabled

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

  if (!org || (!hasCustomLanding && coursesLoading)) {
    return (
      <GeneralWrapperStyled>
        <div className="animate-pulse space-y-6 pt-6">
          <div className="h-6 bg-gray-200 rounded w-40" />
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="bg-white rounded-xl overflow-hidden shadow-sm border border-gray-100">
                <div className="h-[131px] bg-gray-200" />
                <div className="p-3 space-y-2">
                  <div className="h-4 bg-gray-200 rounded w-3/4" />
                  <div className="h-3 bg-gray-200 rounded w-1/2" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </GeneralWrapperStyled>
    )
  }

  return (
    <div className="w-full">
      {orgJsonLd && <JsonLd data={orgJsonLd} />}
      {hasCustomLanding ? (
        <LandingCustom landing={landingConfig} orgslug={orgslug} />
      ) : (
        <LandingClassic
          courses={courses || []}
          orgslug={orgslug}
          org_id={org.id}
        />
      )}
    </div>
  )
}
