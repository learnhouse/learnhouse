'use client'
import React, { useRef } from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Check, Copy, Download, ShieldCheck, XCircle } from 'lucide-react'
import { LinkedinLogo } from '@phosphor-icons/react'
import toast from 'react-hot-toast'
import CertificatePreview from '@components/Dashboard/Pages/Course/EditCourseCertification/CertificatePreview'
import { CertificateArtworkProps } from '@components/Objects/Certificates/CertificateArtwork'
import GeneralWrapperStyled from '@components/Objects/StyledElements/Wrappers/GeneralWrapper'
import {
  CERTIFICATE_CAPTURE_WIDTH,
  certificateFileName,
  downloadCertificateNodeAsPdf,
} from '@services/courses/certificateDownload'

export interface CertificateShowcaseProps {
  certificate: CertificateArtworkProps & { certificateId: string; learnerName: string }
  issuerName: string
  /** ISO date the credential was issued, for the LinkedIn link. */
  issuedAt: string
  verifyLink: string
  /** The holder viewing their own certificate gets download/LinkedIn actions. */
  isOwner: boolean
  /** What the certificate was earned for: a course row or a path's courses. */
  subject: React.ReactNode
}

/** One page layout for every credential: course certificates and path
 * certificates verify, download and share the same way. */
export function CertificateShowcase({
  certificate,
  issuerName,
  issuedAt,
  verifyLink,
  isOwner,
  subject,
}: CertificateShowcaseProps) {
  const { t } = useTranslation()
  const captureRef = useRef<HTMLDivElement>(null)

  const download = async () => {
    if (!captureRef.current) return
    try {
      await downloadCertificateNodeAsPdf(captureRef.current, certificateFileName(certificate.certificationName))
    } catch {
      toast.error(t('certificate.download_failed'))
    }
  }

  const copy = async (value: string, message: string) => {
    await navigator.clipboard.writeText(value)
    toast.success(message)
  }

  const issued = new Date(issuedAt)
  const linkedInUrl =
    'https://www.linkedin.com/profile/add?' +
    new URLSearchParams({
      startTask: 'CERTIFICATION_NAME',
      name: certificate.certificationName,
      organizationName: issuerName,
      issueYear: String(issued.getFullYear()),
      issueMonth: String(issued.getMonth() + 1),
      certUrl: verifyLink,
      certId: certificate.certificateId,
    }).toString()

  return (
    <GeneralWrapperStyled>
      <div className="pb-16">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-6">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-green-700 bg-green-50 ring-1 ring-green-600/15 rounded-full px-2.5 py-1 mb-3">
              <ShieldCheck size={14} />
              {t('certificate.page.verified')}
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 tracking-tight max-sm:line-clamp-3 sm:truncate" dir="auto">
              {certificate.certificationName}
            </h1>
            <p className="text-gray-500 mt-1" dir="auto">
              {t('certificate.page.issued_line', {
                name: certificate.learnerName,
                issuer: issuerName,
                date: certificate.awardedDate,
              })}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white rounded-xl nice-shadow p-3 sm:p-5">
              <div className="rounded-lg overflow-hidden ring-1 ring-black/5">
                <CertificatePreview {...certificate} qrCodeLink={verifyLink} />
              </div>
            </div>
            {subject}
          </div>

          <aside className="space-y-4 lg:sticky lg:top-[calc(6rem+var(--lh-company-bar-h,0px))]">
            <div className="bg-white rounded-xl nice-shadow p-5 space-y-2.5">
              {isOwner && (
                <>
                  <button
                    type="button"
                    onClick={download}
                    className="w-full inline-flex justify-center items-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-black hover:bg-black/90 rounded-lg transition-colors"
                  >
                    <Download size={16} />
                    {t('certificate.page.download')}
                  </button>
                  <a
                    href={linkedInUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full inline-flex justify-center items-center gap-2 px-4 py-2.5 text-sm font-medium text-gray-800 bg-white ring-1 ring-gray-200 hover:bg-gray-50 rounded-lg transition-colors"
                  >
                    <LinkedinLogo size={16} weight="fill" />
                    {t('certificate.page.add_to_linkedin')}
                  </a>
                </>
              )}
              <button
                type="button"
                onClick={() => copy(verifyLink, t('certificate.page.link_copied'))}
                className="w-full inline-flex justify-center items-center gap-2 px-4 py-2.5 text-sm font-medium text-gray-800 bg-white ring-1 ring-gray-200 hover:bg-gray-50 rounded-lg transition-colors"
              >
                <Copy size={16} />
                {t('certificate.page.copy_link')}
              </button>
            </div>

            <dl className="bg-white rounded-xl nice-shadow p-5 divide-y divide-gray-100 text-sm">
              {[
                [t('certificate.page.recipient'), certificate.learnerName],
                [t('certificate.page.issuer'), issuerName],
                [t('certificate.page.issued_on'), certificate.awardedDate],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between gap-4 py-2.5 first:pt-0">
                  <dt className="text-gray-500">{label}</dt>
                  <dd className="font-medium text-gray-900 text-end truncate" dir="auto">{value}</dd>
                </div>
              ))}
              <div className="pt-2.5">
                <dt className="text-gray-500 mb-1">{t('certificate.page.credential_id')}</dt>
                <dd className="flex items-center gap-2">
                  <code className="font-mono text-xs text-gray-900 bg-gray-50 rounded px-2 py-1 truncate flex-1">
                    {certificate.certificateId}
                  </code>
                  <button
                    type="button"
                    onClick={() => copy(certificate.certificateId, t('certificate.page.id_copied'))}
                    aria-label={t('certificate.page.copy_id')}
                    className="p-1.5 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-50"
                  >
                    <Copy size={14} />
                  </button>
                </dd>
              </div>
            </dl>
          </aside>
        </div>
      </div>

      {/* PDF source: same artwork at scale 1, kept in layout (not
          display:none) because html2canvas cannot measure a hidden subtree. */}
      {isOwner && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed top-0 start-0 -z-50 opacity-0"
          style={{ transform: 'translateX(-200vw)' }}
        >
          <div ref={captureRef} style={{ width: CERTIFICATE_CAPTURE_WIDTH }}>
            <CertificatePreview {...certificate} qrCodeLink={verifyLink} />
          </div>
        </div>
      )}
    </GeneralWrapperStyled>
  )
}

/** "What it was earned for" card: a titled box the subject rows sit in. */
export function CertificateSubject({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-white rounded-xl nice-shadow p-5">
      <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">{title}</h2>
      {children}
    </section>
  )
}

/** Shown for an unknown or revoked credential ID. */
export function CertificateNotFound({ certificateUuid, backHref, backLabel }: { certificateUuid: string; backHref: string; backLabel: string }) {
  const { t } = useTranslation()
  return (
    <div className="flex justify-center py-24 px-4">
      <div className="bg-white rounded-xl nice-shadow p-8 max-w-md w-full text-center">
        <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-4">
          <XCircle className="w-6 h-6 text-red-600" />
        </div>
        <h1 className="text-xl font-bold text-gray-900">{t('certificate.page.not_found')}</h1>
        <p className="text-sm text-gray-500 mt-2">{t('certificate.page.not_found_hint')}</p>
        <code className="inline-block mt-3 font-mono text-xs bg-gray-50 rounded px-2 py-1 text-gray-700 break-all">
          {certificateUuid}
        </code>
        <div className="mt-6">
          <Link
            href={backHref}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-black hover:bg-black/90 rounded-lg"
          >
            <ArrowLeft size={16} className="rtl:rotate-180" />
            {backLabel}
          </Link>
        </div>
      </div>
    </div>
  )
}

export function CertificateShowcaseSkeleton() {
  return (
    <GeneralWrapperStyled>
      <div className="animate-pulse space-y-6">
        <div className="space-y-3">
          <div className="h-6 w-24 bg-gray-100 rounded-full" />
          <div className="h-8 w-80 bg-gray-200 rounded" />
          <div className="h-4 w-96 bg-gray-100 rounded" />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-white rounded-xl nice-shadow aspect-[1123/794]" />
          <div className="h-56 bg-white rounded-xl nice-shadow" />
        </div>
      </div>
    </GeneralWrapperStyled>
  )
}

/** A check-list row for each course a certificate covers. */
export function CertificateCourseRow({ name, href, tag }: { name: string; href?: string; tag?: string }) {
  const row = (
    <span className="flex items-center gap-3 py-2 text-sm text-gray-800">
      <span className="w-5 h-5 rounded-full bg-green-50 text-green-700 flex items-center justify-center shrink-0">
        <Check size={12} strokeWidth={3} />
      </span>
      <span className="flex-1 truncate font-medium" dir="auto">{name}</span>
      {tag && <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">{tag}</span>}
    </span>
  )
  return href ? (
    <Link href={href} className="block -mx-2 px-2 rounded-md hover:bg-gray-50">
      {row}
    </Link>
  ) : (
    row
  )
}
