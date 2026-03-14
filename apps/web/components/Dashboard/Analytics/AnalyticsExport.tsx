'use client'
import React, { useState, useRef, useEffect } from 'react'
import { DownloadSimple, CaretDown } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { getAPIUrl } from '@services/config/config'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'

type ExportFormat = 'json' | 'csv'

interface ExportAnalyticsButtonProps {
  days: string
  queries: string[]
  courseId?: string | null
}

export default function ExportAnalyticsButton({
  days,
  queries,
  courseId,
}: ExportAnalyticsButtonProps) {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const org = useOrg() as any
  const token = session?.data?.tokens?.access_token
  const orgId = org?.id

  const [open, setOpen] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  async function handleExport(format: ExportFormat) {
    if (!orgId || !token || downloading) return
    setDownloading(true)
    setOpen(false)

    try {
      const params = new URLSearchParams({
        org_id: String(orgId),
        days,
        format,
        queries: queries.join(','),
      })
      if (courseId) params.set('course_uuid', courseId)

      const resp = await fetch(`${getAPIUrl()}analytics/export?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      })

      if (!resp.ok) throw new Error(`Export failed: ${resp.status}`)

      const blob = await resp.blob()
      const ext = format === 'csv' ? 'csv' : 'json'
      const filename = `analytics_${days}d.${ext}`

      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('Export failed:', err)
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        disabled={downloading}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors disabled:opacity-50"
      >
        <DownloadSimple size={14} />
        {downloading
          ? t('analytics.export.downloading')
          : t('analytics.export.button')}
        {!downloading && <CaretDown aria-hidden="true" size={10} />}
      </button>

      {open && (
        <div className="absolute right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-20 min-w-[120px]">
          <button
            onClick={() => handleExport('json')}
            className="w-full text-left px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 rounded-t-lg"
          >
            {t('analytics.export.json')}
          </button>
          <button
            onClick={() => handleExport('csv')}
            className="w-full text-left px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 rounded-b-lg"
          >
            {t('analytics.export.csv')}
          </button>
        </div>
      )}
    </div>
  )
}
