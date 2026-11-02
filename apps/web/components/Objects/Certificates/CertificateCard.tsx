'use client'
import React from 'react'
import Link from 'next/link'
import CertificatePreview from '@components/Dashboard/Pages/Course/EditCourseCertification/CertificatePreview'
import { CertificateArtworkProps } from '@components/Objects/Certificates/CertificateArtwork'

/** Card for a certificate in a list: the real certificate, shrunk, over its
 * name and what it was earned for. */
function CertificateCard({
  href,
  certificate,
  subtitle,
  tag,
  date,
}: {
  href: string
  certificate: CertificateArtworkProps
  subtitle: string
  tag?: string
  date: string
}) {
  return (
    <Link
      href={href}
      data-kbd-item=""
      className="group flex flex-col bg-white rounded-xl nice-shadow overflow-hidden transition-all duration-300 hover:scale-[1.01]"
    >
      <div className="bg-gray-50 p-4">
        <div className="rounded-sm overflow-hidden shadow-sm ring-1 ring-black/5 pointer-events-none">
          <CertificatePreview {...certificate} />
        </div>
      </div>
      <div className="p-3 space-y-1.5 border-t border-gray-100">
        <div className="text-base font-bold text-gray-900 leading-tight line-clamp-1" dir="auto">
          {certificate.certificationName}
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-500 min-w-0">
          {tag && (
            <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">
              {tag}
            </span>
          )}
          {subtitle !== certificate.certificationName && (
            <span className="truncate" dir="auto">{subtitle}</span>
          )}
        </div>
        <div className="pt-1.5 border-t border-gray-100 text-[10px] font-bold text-gray-400 uppercase tracking-widest">
          {date}
        </div>
      </div>
    </Link>
  )
}

export default CertificateCard
