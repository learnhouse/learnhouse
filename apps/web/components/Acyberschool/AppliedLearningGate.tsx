'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { usePathname } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { BriefcaseBusiness, CheckCircle2, X } from 'lucide-react'
import toast from 'react-hot-toast'

import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useActivity } from '@/hooks/queries/useActivity'
import { useCourseMeta } from '@/hooks/queries/useCourses'
import {
  getAppliedLearningReflection,
  saveAppliedLearningReflection,
  type AppliedLearningEntry,
} from '@services/applied-learning/appliedLearning'

const BRAND_RED = '#C51635'
const BRAND_NAVY = '#0B263D'

function parseActivityPath(pathname: string | null) {
  if (!pathname) return null
  const match = pathname.match(/\/course\/([^/]+)\/activity\/([^/?#]+)/)
  if (!match || match[2] === 'end') return null
  return { courseUuid: decodeURIComponent(match[1]), activityUuid: decodeURIComponent(match[2]) }
}

function findModuleName(course: any, activityUuid: string) {
  for (const chapter of course?.chapters || []) {
    const found = (chapter.activities || []).some(
      (item: any) => item.activity_uuid === activityUuid
    )
    if (found) return chapter.name || ''
  }
  return ''
}

export default function AppliedLearningGate() {
  const pathname = usePathname()
  const org = useOrg() as any
  const session = useLHSession() as any
  const queryClient = useQueryClient()
  const route = useMemo(() => parseActivityPath(pathname), [pathname])
  const courseUuid = route?.courseUuid || ''
  const activityUuid = route?.activityUuid || ''
  const token = session?.data?.tokens?.access_token as string | undefined

  const { data: activity } = useActivity(activityUuid)
  const { data: course } = useCourseMeta(courseUuid)

  const reflectionQuery = useQuery({
    queryKey: ['applied-learning', 'reflection', activityUuid],
    queryFn: () => getAppliedLearningReflection(activityUuid, token),
    enabled: !!activityUuid && session?.status === 'authenticated' && !!token,
    staleTime: 30_000,
  })

  const existing = reflectionQuery.data as AppliedLearningEntry | null | undefined
  const satisfied = !!existing?.planned_application?.trim()
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [plannedApplication, setPlannedApplication] = useState('')
  const [previousApplication, setPreviousApplication] = useState('')
  const [measurableChange, setMeasurableChange] = useState('')
  const [evidenceNotes, setEvidenceNotes] = useState('')

  useEffect(() => {
    setOpen(false)
  }, [activityUuid])

  useEffect(() => {
    setPlannedApplication(existing?.planned_application || '')
    setPreviousApplication(existing?.previous_application || '')
    setMeasurableChange(existing?.measurable_change || '')
    setEvidenceNotes(existing?.evidence_notes || '')
  }, [existing?.entry_uuid, activityUuid])

  if (!route || session?.status !== 'authenticated') return null

  const moduleName = findModuleName(course, activityUuid)
  const status = measurableChange.trim()
    ? 'measured'
    : previousApplication.trim()
      ? 'applied'
      : 'planned'

  const save = async () => {
    if (plannedApplication.trim().length < 3) {
      toast.error('Tell us how you will apply this learning before saving.')
      return
    }
    if (!org?.id || !courseUuid || !activityUuid || !token) {
      toast.error('This lesson is still loading. Please try again in a moment.')
      return
    }

    setSaving(true)
    try {
      const saved = await saveAppliedLearningReflection(
        {
          org_id: org.id,
          course_uuid: course?.course_uuid || courseUuid,
          activity_uuid: activity?.activity_uuid || activityUuid,
          activity_name: activity?.name || '',
          module_name: moduleName,
          planned_application: plannedApplication.trim(),
          previous_application: previousApplication.trim(),
          measurable_change: measurableChange.trim(),
          evidence_notes: evidenceNotes.trim(),
          application_status: status,
        },
        token
      )

      queryClient.setQueryData(['applied-learning', 'reflection', activityUuid], saved)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['applied-learning', 'portfolio'] }),
        queryClient.invalidateQueries({ queryKey: ['applied-learning', 'summary'] }),
        queryClient.invalidateQueries({ queryKey: ['applied-learning', 'assistant-context'] }),
      ])
      setOpen(false)
      toast.success('Saved to your portfolio.')
    } catch (error: any) {
      toast.error(error?.message || 'Could not save to your portfolio. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-4 z-[70] flex min-h-12 items-center gap-2 rounded-full px-4 py-3 text-sm font-extrabold text-white shadow-[0_12px_35px_rgba(11,38,61,0.24)] sm:bottom-7 sm:right-7"
        style={{ backgroundColor: satisfied ? BRAND_NAVY : BRAND_RED }}
      >
        {satisfied ? <CheckCircle2 className="h-4 w-4" /> : <BriefcaseBusiness className="h-4 w-4" />}
        {satisfied ? 'Application saved' : 'Apply this at work'}
      </button>

      {open && (
        <div className="fixed inset-0 z-[1000] flex items-end justify-center bg-black/50 p-0 backdrop-blur-[2px] sm:items-center sm:p-5">
          <div className="max-h-[94vh] w-full overflow-y-auto rounded-t-[28px] bg-white shadow-2xl sm:max-w-2xl sm:rounded-[28px]">
            <div className="sticky top-0 z-10 flex items-start justify-between border-b border-black/[0.07] bg-white px-5 py-5 sm:px-7">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.2em]" style={{ color: BRAND_RED }}>Apply this at work</p>
                <h2 className="mt-1 text-2xl font-black tracking-[-0.035em] text-[#101418]">Turn this lesson into action.</h2>
                <p className="mt-1 text-sm text-black/50">Your answer is saved to your lifetime learning portfolio.</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="rounded-full p-2 text-black/40 hover:bg-black/[0.05]" aria-label="Close">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-6 px-5 py-6 sm:px-7">
              <div>
                <label className="text-sm font-extrabold text-[#101418]">How will you apply what you just learned in your organisation?</label>
                <p className="mt-1 text-xs leading-5 text-black/45">Name the task, decision, process or behaviour you will change.</p>
                <textarea value={plannedApplication} onChange={(e) => setPlannedApplication(e.target.value)} rows={4} placeholder="For example: In our next management meeting I will use this approach to..." className="mt-3 w-full resize-y rounded-2xl border border-black/10 bg-[#FAFAFA] p-4 text-sm leading-6 outline-none transition focus:border-[#C51635]/50 focus:ring-4 focus:ring-[#C51635]/[0.07]" />
              </div>

              <div>
                <label className="text-sm font-extrabold text-[#101418]">Have you already applied something from this or earlier learning?</label>
                <p className="mt-1 text-xs leading-5 text-black/45">Optional. Record what you actually did.</p>
                <textarea value={previousApplication} onChange={(e) => setPreviousApplication(e.target.value)} rows={3} placeholder="I applied..." className="mt-3 w-full resize-y rounded-2xl border border-black/10 bg-[#FAFAFA] p-4 text-sm leading-6 outline-none transition focus:border-[#C51635]/50 focus:ring-4 focus:ring-[#C51635]/[0.07]" />
              </div>

              <div>
                <label className="text-sm font-extrabold text-[#101418]">What measurable change can you record?</label>
                <p className="mt-1 text-xs leading-5 text-black/45">Optional today. You can update this later when the result is visible.</p>
                <textarea value={measurableChange} onChange={(e) => setMeasurableChange(e.target.value)} rows={3} placeholder="Time saved, revenue gained, errors reduced, response time improved, people reached..." className="mt-3 w-full resize-y rounded-2xl border border-black/10 bg-[#FAFAFA] p-4 text-sm leading-6 outline-none transition focus:border-[#C51635]/50 focus:ring-4 focus:ring-[#C51635]/[0.07]" />
              </div>

              <details className="rounded-2xl border border-black/[0.07] bg-white px-4 py-3">
                <summary className="cursor-pointer text-sm font-bold text-black/60">Add proof or notes</summary>
                <textarea value={evidenceNotes} onChange={(e) => setEvidenceNotes(e.target.value)} rows={3} placeholder="Link, document name, metric source or other evidence..." className="mt-3 w-full resize-y rounded-xl border border-black/10 bg-[#FAFAFA] p-3 text-sm leading-6 outline-none" />
              </details>
            </div>

            <div className="sticky bottom-0 flex flex-col gap-3 border-t border-black/[0.07] bg-white px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-7">
              <p className="text-xs leading-5 text-black/45">Saving this does not interrupt your course navigation.</p>
              <button type="button" onClick={save} disabled={saving} className="min-h-12 shrink-0 rounded-xl px-6 py-3 text-sm font-extrabold text-white disabled:opacity-60" style={{ backgroundColor: BRAND_RED }}>
                {saving ? 'Saving...' : 'Save to portfolio'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
