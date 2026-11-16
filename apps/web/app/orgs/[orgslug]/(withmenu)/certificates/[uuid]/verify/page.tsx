import type { Metadata } from 'next'
import CertificateVerificationPage from '@components/Pages/Certificate/CertificateVerificationPage'
import React from 'react'
import { getSeoContext } from '@/lib/seo/context.server'
import { buildPageTitle } from '@/lib/seo/utils'
import { clipDescription } from '@/lib/seo/meta'
import { fetchCertificate, recipientName } from '@/lib/seo/certificate.server'
import { getCourseThumbnailMediaDirectory } from '@services/media/media'

interface CertificateVerifyPageProps {
  params: Promise<{
    orgslug: string
    uuid: string
  }>
}

/**
 * Verification pages carry a person's name, so they are never indexed
 * (`noindex, follow`), but they unfurl well where learners share them
 * (LinkedIn, Slack...) with the credential, the course and its image.
 */
export async function generateMetadata({ params }: CertificateVerifyPageProps): Promise<Metadata> {
  const { orgslug, uuid } = await params
  const ctx = await getSeoContext(orgslug)
  const data = ctx.org?.id ? await fetchCertificate(uuid, ctx.org.id) : null
  const robots = { index: false, follow: true }
  if (!data) return { title: buildPageTitle('Certificate verification', ctx.org?.name || '', ctx.seo), robots }
  const credential = data.certification?.config?.certification_name || data.course?.name || 'Certificate'
  const person = recipientName(data.user)
  const title = buildPageTitle(person ? `${credential}: ${person}` : credential, ctx.org?.name || '', ctx.seo)
  const description = clipDescription(
    `${person ? `${person} earned` : 'Earned'} “${credential}” from ${ctx.org?.name}${data.course?.name ? ` for completing ${data.course.name}` : ''}. Certificate ID ${uuid}.`,
  )
  const image = data.course?.thumbnail_image
    ? getCourseThumbnailMediaDirectory(ctx.org.org_uuid, data.course.course_uuid, data.course.thumbnail_image)
    : ctx.defaultImage
  const url = await ctx.url(`/certificates/${encodeURIComponent(uuid)}/verify`)
  return {
    title,
    description,
    robots,
    alternates: { canonical: url },
    openGraph: { title, description, url, siteName: ctx.org?.name, type: 'website', ...(image ? { images: [{ url: image, alt: credential }] } : {}) },
    twitter: { card: image ? 'summary_large_image' : 'summary', title, description, ...(image ? { images: [image] } : {}) },
  }
}

const CertificateVerifyPage = async ({ params }: CertificateVerifyPageProps) => {
  const { uuid } = await params
  return <CertificateVerificationPage certificateUuid={uuid} />
}

export default CertificateVerifyPage
