'use client'
import React, { useState, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
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

// Beyond this a single task's answers stop being a report and start being a dump.
const MAX_PDF_ANSWERS_PER_TASK = 50

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

  const breakIfNeeded = (height: number) => {
    if (y + height > pageHeight - margin) {
      pdf.addPage()
      y = margin
    }
  }

  const line = (text: string, size = 10, bold = false, indent = 0) => {
    pdf.setFontSize(size)
    pdf.setFont('helvetica', bold ? 'bold' : 'normal')
    const wrapped = pdf.splitTextToSize(text || '', pageWidth - margin * 2 - indent)
    // Measure before deciding on the page break — checking only the current y let a
    // wrapped paragraph start near the bottom and run off the page.
    const height = wrapped.length * (size * 0.45) + 1.5
    breakIfNeeded(height)
    pdf.text(wrapped, margin + indent, y)
    y += height
  }
  const gap = (h = 3) => { y += h }
  const heading = (text: string) => {
    gap(2)
    // Keep the heading with at least one line of its section.
    breakIfNeeded(14)
    line(text, 13, true)
    gap(1)
  }

  dossiers.forEach((d, idx) => {
    if (idx > 0) { pdf.addPage(); y = margin }
    const u = d.user || {}
    const s = d.summary || {}
    const sec = d.security || {}

    line('Student Audit Report', 18, true)
    line(fullName(u) + `  (@${u.username})`, 12)
    line(u.email || '', 10)
    line('Generated ' + fmtDateTime(new Date().toISOString()), 9)
    line('Contains teacher answer keys — internal use only.', 9)
    gap(2)

    heading('Summary')
    line(`Courses enrolled: ${s.courses_enrolled ?? 0} (${s.courses_completed ?? 0} completed)`, 10)
    line(`Average progress: ${s.avg_progress_pct ?? 0}%`, 10)
    line(`Assignments submitted: ${s.assignments_submitted ?? 0}` + (s.avg_grade_pct != null ? `, average grade ${s.avg_grade_pct}%` : ''), 10)
    line(`Certificates earned: ${s.certificates_earned ?? 0}`, 10)
    line(`Connections recorded: ${s.connections ?? 0}, last ${fmtDate(s.last_connection)}`, 10)

    heading('Account & security')
    line(`Email verified: ${sec.email_verified ? 'yes' : 'no'}   Signup method: ${sec.signup_method || '—'}`, 10)
    line(`Last login: ${fmtDateTime(sec.last_login_at)}   IP: ${sec.last_login_ip || '—'}`, 10)

    heading('Connections')
    ;(d.connections || []).slice(0, 100).forEach((c: any) => {
      line(`${fmtDateTime(c.at)}  ${c.event_label || c.event_type}  ${c.ip || ''}  ${c.device || ''}  ${c.method || ''}`, 9)
    })
    if ((d.connections || []).length === 0) line('None recorded.', 9)

    heading('Course progress')
    ;(d.courses || []).forEach((c: any) => {
      line(`${c.course_name || 'Untitled course'} — ${c.progress_pct}% (${c.activities_completed}/${c.activities_total}), ${c.status}`, 9)
    })
    if ((d.courses || []).length === 0) line('No enrollments.', 9)

    heading('Assignments')
    ;(d.assignments || []).forEach((a: any) => {
      const grade = a.grade_display || (a.grade != null ? String(a.grade) : '—')
      line(`${a.title || a.assignment_uuid} — ${grade}${a.points_summary ? ` (${a.points_summary})` : ''}, ${a.status}, attempt ${a.attempt_number}`, 9)
      if (a.course_name) line(`Course: ${a.course_name}`, 8, false, 4)
      ;(a.tasks || []).forEach((tk: any) => {
        const points = tk.submitted ? (tk.points_summary || `${tk.grade}`) : 'not submitted'
        line(`Task ${tk.index} — ${tk.type_label}${tk.title ? `: ${tk.title}` : ''} — ${points}${tk.manually_graded ? ', manually graded' : ''}`, 9, true, 4)
        const answer = tk.answer
        if (!answer) return
        if (answer.kind === 'code' && answer.code) {
          // Source code belongs in the JSON export, not in a printable report.
          line(`${answer.code.language || 'Code'} — ${answer.code.passed_tests}/${answer.code.total_tests} tests passed`, 8, false, 8)
          return
        }
        ;(answer.items || []).slice(0, MAX_PDF_ANSWERS_PER_TASK).forEach((item: any) => {
          line(`Q: ${item.prompt}`, 8, false, 8)
          const verdict = item.correct === true ? '  [Correct]' : item.correct === false ? '  [Wrong]' : ''
          line(`A: ${item.answer_text || '(no answer)'}${verdict}`, 8, false, 8)
          if (item.expected_text && item.expected_text !== item.answer_text) {
            line(`Expected: ${item.expected_text}`, 8, false, 8)
          }
        })
        const hidden = (answer.items || []).length - MAX_PDF_ANSWERS_PER_TASK
        if (hidden > 0) line(`(${hidden} more answers omitted — see the CSV or JSON export)`, 8, false, 8)
      })
    })
    if ((d.assignments || []).length === 0) line('No submissions.', 9)

    heading('Code exercises')
    ;(d.code_submissions || []).slice(0, 100).forEach((cs: any) => {
      line(`${cs.activity_name || 'Untitled activity'}${cs.course_name ? ` (${cs.course_name})` : ''} — ${cs.language || '—'}, ${cs.result_label || (cs.passed ? 'Passed' : 'Failed')}, ${cs.tests_summary || `${cs.passed_tests}/${cs.total_tests}`} tests, ${fmtDateTime(cs.created_at)}`, 9)
    })
    if ((d.code_submissions || []).length === 0) line('None.', 9)

    heading('Community')
    const discussions = d.community?.discussions || []
    const comments = d.community?.comments || []
    discussions.slice(0, 100).forEach((disc: any) => {
      line(`Discussion: ${disc.title} — ${fmtDate(disc.created_at)}`, 9)
    })
    comments.slice(0, 100).forEach((c: any) => {
      line(`Comment in "${c.discussion_title || '—'}": ${c.excerpt || c.content || ''}`, 9)
    })
    if (discussions.length === 0 && comments.length === 0) line('No community activity.', 9)

    heading('Certificates')
    ;(d.certificates || []).forEach((c: any) => {
      line(`${c.course_name} — ${fmtDate(c.created_at)}`, 9)
      line(`Credential ID ${c.credential_id || c.user_certification_uuid}`, 8, false, 4)
    })
    if ((d.certificates || []).length === 0) line('None.', 9)

    const totalSeconds = Number(d.behavior?.user_time_total?.[0]?.total_seconds || 0)
    heading('Behavior')
    line(`Total time on activities: ${fmtDuration(totalSeconds)}`, 9)
    ;(d.behavior?.user_time_by_course || []).slice(0, 50).forEach((b: any) => {
      line(`${b.course_name || 'Untitled course'} — ${fmtDuration(b.total_seconds)}`, 9, false, 4)
    })
    const searches = (d.behavior?.user_searches || []).slice(0, 20)
    if (searches.length > 0) {
      line(`Searches: ${searches.map((s: any) => `${s.query} (${s.count})`).join(', ')}`, 9)
    }
  })

  const name = dossiers.length === 1
    ? `audit-${dossiers[0]?.user?.username || dossiers[0]?.user?.id}.pdf`
    : `audit-${dossiers.length}-students.pdf`
  pdf.save(name)
}

export default function UserAuditExport({ userIds, days = 365, defaultDossier, label }: Props) {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const org = useOrg() as any
  const token = session?.data?.tokens?.access_token
  const orgId = org?.id

  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [includeRaw, setIncludeRaw] = useState(false)
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
      // Off by default — the readable rendering is what a reader wants, and the raw
      // payloads roughly double the file.
      if (includeRaw) params.set('include_raw', 'true')

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
      if (fmt === 'pdf' && defaultDossier && ids.length === 1 && !includeRaw) {
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
        {busy ? t('dashboard.users.analytics.exporting') : label || t('dashboard.users.analytics.export')}
        {!busy && <ChevronDown size={12} />}
      </button>
      {open && (
        <div className="absolute end-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-30 min-w-[190px] overflow-hidden">
          {(['pdf', 'csv', 'json'] as Fmt[]).map((f) => (
            <button
              key={f}
              onClick={() => handle(f)}
              className="w-full text-start px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 uppercase"
            >
              {f}
            </button>
          ))}
          <label className="flex items-start gap-2 px-3 py-2 text-[11px] text-gray-500 border-t border-gray-100 cursor-pointer">
            <input
              type="checkbox"
              checked={includeRaw}
              onChange={(e) => setIncludeRaw(e.target.checked)}
              className="mt-0.5"
            />
            {t('dashboard.users.analytics.export_include_raw', {
              defaultValue: 'Include raw submission data',
            })}
          </label>
        </div>
      )}
    </div>
  )
}
