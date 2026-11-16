import { SeoScripts } from '@components/SEO/SeoScripts'
import { getSeoContext } from '@/lib/seo/context.server'
import { credentialJsonLd } from '@/lib/seo/jsonld'
import { coursePath } from '@/lib/seo/paths'
import { fetchCertificate } from '@/lib/seo/certificate.server'

/** The credential a verification page proves (the page itself is noindex). */
export default async function CertificateSeo({ params }: { params: Promise<{ orgslug: string; uuid: string }> }) {
  const { orgslug, uuid } = await params
  const ctx = await getSeoContext(orgslug)
  const data = ctx.org?.id ? await fetchCertificate(uuid, ctx.org.id) : null
  if (!data) return null
  return (
    <SeoScripts
      items={[
        credentialJsonLd({
          name: data.certification?.config?.certification_name || data.course?.name || 'Certificate',
          url: await ctx.url(`/certificates/${encodeURIComponent(uuid)}/verify`),
          description: data.certification?.config?.certification_description || data.course?.description,
          issuedOn: data.certificate_user?.created_at,
          org: ctx.orgRef,
          courseName: data.course?.name,
          courseUrl: data.course ? await ctx.url(coursePath(data.course)) : undefined,
          credentialId: uuid,
        }),
      ]}
    />
  )
}
