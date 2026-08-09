'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@components/ui/badge'
import { LogIn, Globe, Monitor } from 'lucide-react'
import { fmtDateTime } from '../format'
import { Card, SectionTitle, Empty, P } from './primitives'

export default function ConnectionsSection({ connections }: { connections: any[] }) {
  const { t } = useTranslation()
  return (
    <Card>
      <SectionTitle icon={<LogIn size={18} />} title={t(`${P}.connections.title`)} count={connections.length} />
      {connections.length === 0 ? (
        <Empty label={t(`${P}.connections.empty`)} />
      ) : (
        <ol className="relative border-s border-gray-200 ms-2">
          {connections.map((c, i) => (
            <li key={i} className="mb-5 ms-5">
              <span className="absolute -start-1.5 mt-1.5 h-3 w-3 rounded-full bg-blue-500 border-2 border-white" />
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-sm">{c.event_label || c.event_type}</span>
                {c.method && <Badge variant="secondary">{c.method}</Badge>}
                <span className="text-xs text-gray-400">{fmtDateTime(c.at)}</span>
              </div>
              <div className="flex flex-wrap gap-4 mt-1 text-xs text-gray-500">
                {c.ip && <span className="flex items-center gap-1"><Globe size={12} /> {c.ip}</span>}
                <span className="flex items-center gap-1">
                  <Monitor size={12} />
                  {c.device || t(`${P}.connections.unknown_device`, { defaultValue: 'Unknown device' })}
                </span>
              </div>
              {/* The full agent string stays available for forensics, just not in the
                  reading path — it used to occupy the whole line. */}
              {c.user_agent && (
                <details className="mt-1 text-[11px] text-gray-400">
                  <summary className="cursor-pointer">
                    {t(`${P}.connections.raw_agent`, { defaultValue: 'Raw user agent' })}
                  </summary>
                  <span className="break-all">{c.user_agent}</span>
                </details>
              )}
            </li>
          ))}
        </ol>
      )}
    </Card>
  )
}
