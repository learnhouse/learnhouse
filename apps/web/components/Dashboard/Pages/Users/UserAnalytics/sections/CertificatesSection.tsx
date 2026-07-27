'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { Award } from 'lucide-react'
import { fmtDate } from '../format'
import { Card, SectionTitle, Empty, P } from './primitives'

export default function CertificatesSection({ certificates }: { certificates: any[] }) {
  const { t } = useTranslation()
  return (
    <Card>
      <SectionTitle icon={<Award size={18} />} title={t(`${P}.certificates.title`)} count={certificates.length} />
      {certificates.length === 0 ? (
        <Empty label={t(`${P}.certificates.empty`)} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {certificates.map((c, i) => (
            <div key={i} className="flex items-center gap-3 border border-gray-100 rounded-lg p-3">
              <Award size={20} className="text-amber-500 flex-shrink-0" />
              <div className="min-w-0">
                <div className="font-semibold truncate">{c.course_name}</div>
                <div className="text-xs text-gray-400">{fmtDate(c.created_at)}</div>
                {/* The uuid is the verifiable credential number — worth keeping, but
                    only once it says what it is. */}
                <div className="text-[11px] text-gray-400 truncate">
                  {t(`${P}.certificates.credential_id`, { defaultValue: 'Credential ID' })}:{' '}
                  <span className="font-mono">{c.credential_id || c.user_certification_uuid}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}
