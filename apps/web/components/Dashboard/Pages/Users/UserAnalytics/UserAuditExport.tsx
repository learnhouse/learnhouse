'use client'
import React, { useState, useRef, useEffect } from 'react'
import { Download, ChevronDown } from 'lucide-react'
import { getAPIUrl } from '@services/config/config'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import { fullName, fmtDateTime, fmtDate, fmtDuration } from './format'

type Fmt = 'csv' | 'json' | 'pdf'

interface Props {
  userIds: number[]
  days?: number
  // When exporting a single already-loaded dossier, reuse it for PDF instead of refetching.
  defaultDossier?: any
  label?: string
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/** Build a legal-style, multi-page text PDF from one or more dossiers. */
async function buildPdf(dossiers: any[]) {
  const { default: jsPDF } = await import('jspdf')
  const pdf = new jsPDF('portrait', 'mm', 'a4')
  const margin = 14
  const pageWidth = pdf.internal.pageSize.getWidth()
  const pageHeight = pdf.internal.pageSize.getHeight()
  let y = margin

  const line = (text: string, size = 10, bold = false, indent = 0) => {
    if (y > pageHeight - margin) {
      pdf.addPage()
      y = margin
    }
    pdf.setFontSize(size)
    pdf.setFont('helvetica', bold ? 'bold' : 'normal')
    const wrapped = pdf.splitTextToSize(text, pageWidth - margin * 2 - indent)
    pdf.text(wrapped, margin + indent, y)
    y += wrapped.length * (size * 0.45) + 1.5
  }
  const gap = (h = 3) => { y += h }
  const heading = (text: string) => { gap(2); line(text, 13, true); gap(1) }

  dossiers.forEach((d, idx) => {
    if (idx > 0) { pdf.addPage(); y = margin }
    const u = d.user || {}
    const s = d.summary || {}
    const sec = d.security || {}

    line('Student Audit Report', 18, true)
    line(fullName(u) + `  (@${u.username})`, 12)
    line(u.email || '', 10)
    line('Generated ' + fmtDateTime(new Date().toISOString()), 9)
    gap(2)

    heading('Summary')
    line(`Courses enrolled: ${s.courses_enrolled ?? 0} (${s.courses_completed ?? 0} completed)`, 10)
    line(`Average progress: ${s.avg_progress_pct ?? 0}%`, 10)
    line(`Assignments submitted: ${s.assignments_submitted ?? 0}` + (s.avg_grade != null ? `, average grade ${s.avg_grade}` : ''), 10)
    line(`Certificates earned: ${s.certificates_earned ?? 0}`, 10)
    line(`Connections recorded: ${s.connections ?? 0}, last ${fmtDate(s.last_connection)}`, 10)

    heading('Account & security')
    line(`Email verified: ${sec.email_verified ? 'yes' : 'no'}   Signup method: ${sec.signup_method || '—'}`, 10)
    line(`Last login: ${fmtDateTime(sec.last_login_at)}   IP: ${sec.last_login_ip || '—'}`, 10)

    heading('Connections')
    ;(d.connections || []).slice(0, 100).forEach((c: any) => {
      line(`${fmtDateTime(c.at)}  ${c.event_type}  ${c.ip || ''}  ${(c.metadata?.method) || ''}`, 9)
    })
    if ((d.connections || []).length === 0) line('None recorded.', 9)

    heading('Course progress')
    ;(d.courses || []).forEach((c: any) => {
      line(`${c.course_name || c.course_uuid} — ${c.progress_pct}% (${c.activities_completed}/${c.activities_total}), ${c.status}`, 9)
    })
    if ((d.courses || []).length === 0) line('No enrollments.', 9)

    heading('Assignments')
    ;(d.assignments || []).forEach((a: any) => {
      line(`${a.title || a.assignment_uuid} — grade ${a.grade ?? '—'}/${a.max_grade_value ?? 100}, ${a.status}, attempt ${a.attempt_number}`, 9)
    })
    if ((d.assignments || []).length === 0) line('No submissions.', 9)

    heading('Certificates')
    ;(d.certificates || []).forEach((c: any) => {
      line(`${c.course_name} — ${fmtDate(c.created_at)} (${c.user_certification_uuid})`, 9)
    })
    if ((d.certificates || []).length === 0) line('None.', 9)

    const totalSeconds = Number(d.behavior?.user_time_total?.[0]?.total_seconds || 0)
    heading('Behavior')
    line(`Total time on activities: ${fmtDuration(totalSeconds)}`, 9)
  })

  const name = dossiers.length === 1
    ? `audit-${dossiers[0]?.user?.username || dossiers[0]?.user?.id}.pdf`
    : `audit-${dossiers.length}-students.pdf`
  pdf.save(name)
}

export default function UserAuditExport({ userIds, days = 365, defaultDossier, label }: Props) {
  const session = useLHSession() as any
  const org = useOrg() as any
  const token = session?.data?.tokens?.access_token
  const orgId = org?.id

  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onOutside)
    return () => document.removeEventListener('mousedown', onOutside)
  }, [])

  const ids = userIds.filter((id) => !!id)

  async function handle(fmt: Fmt) {
    if (!orgId || !token || busy || ids.length === 0) return
    setBusy(true)
    setOpen(false)
    try {
      const params = new URLSearchParams({
        org_id: String(orgId),
        user_ids: ids.join(','),
        days: String(days),
      })

      if (fmt === 'csv') {
        params.set('format', 'csv')
        const resp = await fetch(`${getAPIUrl()}audit/export?${params}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!resp.ok) throw new Error(`${resp.status}`)
        triggerDownload(await resp.blob(), ids.length === 1 ? `audit-user-${ids[0]}.csv` : `audit-${ids.length}-users.csv`)
        return
      }

      // JSON + PDF both need the JSON dossiers.
      let dossiers: any[]
      if (fmt === 'pdf' && defaultDossier && ids.length === 1) {
        dossiers = [defaultDossier]
      } else {
        params.set('format', 'json')
        const resp = await fetch(`${getAPIUrl()}audit/export?${params}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!resp.ok) throw new Error(`${resp.status}`)
        dossiers = (await resp.json()).data || []
      }

      if (fmt === 'json') {
        triggerDownload(
          new Blob([JSON.stringify(dossiers, null, 2)], { type: 'application/json' }),
          ids.length === 1 ? `audit-user-${ids[0]}.json` : `audit-${ids.length}-users.json`
        )
      } else {
        await buildPdf(dossiers)
      }
    } catch (err) {
      console.error('Audit export failed:', err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div ref={ref} className="relative flex-shrink-0">
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={busy || ids.length === 0}
        className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg bg-gray-900 text-white hover:bg-gray-800 transition-colors disabled:opacity-50"
      >
        <Download size={15} />
        {busy ? 'Exporting…' : label || 'Export'}
        {!busy && <ChevronDown size={12} />}
      </button>
      {open && (
        <div className="absolute right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-30 min-w-[130px] overflow-hidden">
          {(['pdf', 'csv', 'json'] as Fmt[]).map((f) => (
            <button
              key={f}
              onClick={() => handle(f)}
              className="w-full text-left px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 uppercase"
            >
              {f}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
