'use client'

import React, { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { BriefcaseBusiness, Check, ChevronDown, FileText, Layers3, Plus, Save, Target, TrendingUp, X } from 'lucide-react'
import toast from 'react-hot-toast'

import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useCourses } from '@/hooks/queries/useCourses'
import {
  getAppliedLearningSummary,
  getMyAppliedLearning,
  getMyCapstones,
  saveAppliedLearningReflection,
  saveCapstone,
  type AppliedLearningCapstone,
  type AppliedLearningEntry,
} from '@services/applied-learning/appliedLearning'

const RED = '#C51635'
const NAVY = '#0B263D'

function clean(value?: string) {
  return (value || '').replace('course_', '').replace('activity_', '')
}

function dateLabel(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).format(date)
}

function statusLabel(status: string) {
  if (status === 'measured') return 'Measured change'
  if (status === 'applied') return 'Applied'
  return 'Planned'
}

function EntryEditor({ entry, onClose, onSaved }: { entry: AppliedLearningEntry; onClose: () => void; onSaved: (entry: AppliedLearningEntry) => void }) {
  const session = useLHSession() as any
  const [planned, setPlanned] = useState(entry.planned_application)
  const [applied, setApplied] = useState(entry.previous_application)
  const [change, setChange] = useState(entry.measurable_change)
  const [notes, setNotes] = useState(entry.evidence_notes)
  const [saving, setSaving] = useState(false)

  const save = async () => {
    if (planned.trim().length < 3) return
    setSaving(true)
    try {
      const saved = await saveAppliedLearningReflection(
        {
          org_id: entry.org_id,
          course_uuid: entry.course_uuid,
          activity_uuid: entry.activity_uuid,
          activity_name: entry.activity_name,
          module_name: entry.module_name,
          planned_application: planned,
          previous_application: applied,
          measurable_change: change,
          evidence_notes: notes,
          application_status: change.trim() ? 'measured' : applied.trim() ? 'applied' : 'planned',
        },
        session?.data?.tokens?.access_token
      )
      onSaved(saved)
      toast.success('Portfolio updated.')
      onClose()
    } catch (error: any) {
      toast.error(error?.message || 'Could not update this entry.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[1000] flex items-end justify-center bg-black/50 sm:items-center sm:p-5">
      <div className="max-h-[94vh] w-full overflow-y-auto rounded-t-[28px] bg-white sm:max-w-2xl sm:rounded-[28px]">
        <div className="sticky top-0 flex items-center justify-between border-b border-black/[0.07] bg-white px-5 py-4 sm:px-7">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.2em]" style={{ color: RED }}>Applied learning</p>
            <h3 className="mt-1 text-xl font-black">Update the result</h3>
          </div>
          <button onClick={onClose} className="rounded-full p-2 text-black/40 hover:bg-black/[0.04]"><X className="h-5 w-5" /></button>
        </div>
        <div className="space-y-5 p-5 sm:p-7">
          <label className="block text-sm font-bold">How you planned to apply it
            <textarea value={planned} onChange={(e) => setPlanned(e.target.value)} rows={3} className="mt-2 w-full rounded-2xl border border-black/10 bg-[#FAFAFA] p-4 text-sm font-normal leading-6 outline-none" />
          </label>
          <label className="block text-sm font-bold">What you actually applied
            <textarea value={applied} onChange={(e) => setApplied(e.target.value)} rows={3} placeholder="Come back after applying the learning and record what you did." className="mt-2 w-full rounded-2xl border border-black/10 bg-[#FAFAFA] p-4 text-sm font-normal leading-6 outline-none" />
          </label>
          <label className="block text-sm font-bold">Measurable change
            <textarea value={change} onChange={(e) => setChange(e.target.value)} rows={3} placeholder="What changed, by how much, compared with what?" className="mt-2 w-full rounded-2xl border border-black/10 bg-[#FAFAFA] p-4 text-sm font-normal leading-6 outline-none" />
          </label>
          <label className="block text-sm font-bold">Proof or notes
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="mt-2 w-full rounded-2xl border border-black/10 bg-[#FAFAFA] p-4 text-sm font-normal leading-6 outline-none" />
          </label>
        </div>
        <div className="sticky bottom-0 flex justify-end border-t border-black/[0.07] bg-white p-4 sm:px-7">
          <button disabled={saving} onClick={save} className="flex min-h-12 items-center gap-2 rounded-xl px-6 py-3 text-sm font-extrabold text-white disabled:opacity-60" style={{ backgroundColor: RED }}>
            <Save className="h-4 w-4" /> {saving ? 'Saving...' : 'Save update'}
          </button>
        </div>
      </div>
    </div>
  )
}

function CapstoneBuilder({ entries, orgId, existing, onSaved }: { entries: AppliedLearningEntry[]; orgId: number; existing?: AppliedLearningCapstone | null; onSaved: () => void }) {
  const session = useLHSession() as any
  const [selected, setSelected] = useState<string[]>(existing?.selected_entry_uuids || entries.filter((e) => e.application_status !== 'planned').map((e) => e.entry_uuid))
  const [title, setTitle] = useState(existing?.title || '')
  const [challenge, setChallenge] = useState(existing?.challenge || '')
  const [applied, setApplied] = useState(existing?.what_i_applied || '')
  const [impact, setImpact] = useState(existing?.measurable_impact || '')
  const [lessons, setLessons] = useState(existing?.lessons_learned || '')
  const [nextSteps, setNextSteps] = useState(existing?.next_steps || '')
  const [saving, setSaving] = useState(false)

  const selectedEntries = entries.filter((entry) => selected.includes(entry.entry_uuid))

  const draftFromPortfolio = () => {
    if (!selectedEntries.length) {
      toast.error('Select at least one portfolio entry first.')
      return
    }
    if (!applied.trim()) {
      setApplied(selectedEntries.map((e) => e.previous_application || e.planned_application).filter(Boolean).map((v) => `• ${v}`).join('\n'))
    }
    if (!impact.trim()) {
      setImpact(selectedEntries.map((e) => e.measurable_change).filter(Boolean).map((v) => `• ${v}`).join('\n'))
    }
    if (!nextSteps.trim()) {
      setNextSteps(selectedEntries.map((e) => e.planned_application).filter(Boolean).slice(-3).map((v) => `• ${v}`).join('\n'))
    }
  }

  const save = async () => {
    if (title.trim().length < 2) {
      toast.error('Give your capstone a title.')
      return
    }
    setSaving(true)
    try {
      await saveCapstone({
        org_id: orgId,
        capstone_uuid: existing?.capstone_uuid,
        title,
        challenge,
        what_i_applied: applied,
        measurable_impact: impact,
        lessons_learned: lessons,
        next_steps: nextSteps,
        selected_entry_uuids: selected,
        status: 'draft',
      }, session?.data?.tokens?.access_token)
      toast.success('Capstone draft saved.')
      onSaved()
    } catch (error: any) {
      toast.error(error?.message || 'Could not save your capstone.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[0.85fr_1.15fr]">
      <aside className="rounded-[24px] border border-black/[0.08] bg-white p-5 lg:sticky lg:top-20 lg:self-start">
        <p className="text-[10px] font-black uppercase tracking-[0.2em]" style={{ color: RED }}>Choose the proof</p>
        <h3 className="mt-2 text-xl font-black">Portfolio entries</h3>
        <p className="mt-2 text-sm leading-6 text-black/50">Select the applications that tell the strongest story.</p>
        <div className="mt-5 max-h-[480px] space-y-2 overflow-y-auto pr-1">
          {entries.map((entry) => {
            const checked = selected.includes(entry.entry_uuid)
            return (
              <button key={entry.entry_uuid} onClick={() => setSelected(checked ? selected.filter((id) => id !== entry.entry_uuid) : [...selected, entry.entry_uuid])} className={`w-full rounded-2xl border p-3 text-left transition ${checked ? 'border-[#C51635]/30 bg-[#C51635]/[0.045]' : 'border-black/[0.07] bg-white'}`}>
                <div className="flex gap-3">
                  <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${checked ? 'border-[#C51635] bg-[#C51635] text-white' : 'border-black/20'}`}>{checked && <Check className="h-3 w-3" />}</span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold">{entry.activity_name || 'Learning application'}</p>
                    <p className="mt-1 line-clamp-2 text-xs leading-5 text-black/45">{entry.previous_application || entry.planned_application}</p>
                  </div>
                </div>
              </button>
            )
          })}
        </div>
        <button onClick={draftFromPortfolio} className="mt-4 w-full rounded-xl border border-black/10 px-4 py-3 text-sm font-extrabold text-[#0B263D] hover:bg-black/[0.025]">Build draft from selected entries</button>
      </aside>

      <section className="rounded-[24px] border border-black/[0.08] bg-white p-5 sm:p-7">
        <div className="mb-6">
          <p className="text-[10px] font-black uppercase tracking-[0.2em]" style={{ color: RED }}>Capstone builder</p>
          <h3 className="mt-2 text-2xl font-black tracking-[-0.03em]">Turn application into a coherent story.</h3>
        </div>
        <div className="space-y-5">
          <label className="block text-sm font-bold">Capstone title
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="A clear title for the change you created" className="mt-2 min-h-12 w-full rounded-xl border border-black/10 bg-[#FAFAFA] px-4 text-sm font-normal outline-none" />
          </label>
          {[
            ['The challenge or opportunity', challenge, setChallenge, 'What was happening before you acted?'],
            ['What you applied', applied, setApplied, 'Which concepts, tools or behaviours did you put into practice?'],
            ['Measurable impact', impact, setImpact, 'What changed? Include numbers, time, quality, reach or other credible measures.'],
            ['What you learned', lessons, setLessons, 'What worked, what did not, and what would you do differently?'],
            ['What happens next', nextSteps, setNextSteps, 'How will you sustain or extend the change?'],
          ].map(([label, value, setter, placeholder]: any) => (
            <label key={label} className="block text-sm font-bold">{label}
              <textarea value={value} onChange={(e) => setter(e.target.value)} rows={4} placeholder={placeholder} className="mt-2 w-full rounded-2xl border border-black/10 bg-[#FAFAFA] p-4 text-sm font-normal leading-6 outline-none" />
            </label>
          ))}
          <div className="flex justify-end pt-2">
            <button disabled={saving} onClick={save} className="flex min-h-12 items-center gap-2 rounded-xl px-6 py-3 text-sm font-extrabold text-white disabled:opacity-60" style={{ backgroundColor: RED }}>
              <Save className="h-4 w-4" /> {saving ? 'Saving...' : 'Save capstone'}
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}

export default function AppliedLearningPortfolio({ orgslug }: { orgslug: string }) {
  const org = useOrg() as any
  const session = useLHSession() as any
  const queryClient = useQueryClient()
  const token = session?.data?.tokens?.access_token as string | undefined
  const [tab, setTab] = useState<'portfolio' | 'capstone'>('portfolio')
  const [editing, setEditing] = useState<AppliedLearningEntry | null>(null)
  const [openCourse, setOpenCourse] = useState<string | null>(null)

  const portfolioQuery = useQuery({
    queryKey: ['applied-learning', 'portfolio', org?.id],
    queryFn: () => getMyAppliedLearning(org?.id, token),
    enabled: !!org?.id && session?.status === 'authenticated',
  })
  const summaryQuery = useQuery({
    queryKey: ['applied-learning', 'summary', org?.id],
    queryFn: () => getAppliedLearningSummary(org?.id, token),
    enabled: !!org?.id && session?.status === 'authenticated',
  })
  const capstonesQuery = useQuery({
    queryKey: ['applied-learning', 'capstones', org?.id],
    queryFn: () => getMyCapstones(org?.id, token),
    enabled: !!org?.id && session?.status === 'authenticated',
  })
  const { data: courses = [] } = useCourses(orgslug)

  const entries = portfolioQuery.data || []
  const summary = summaryQuery.data || { entries: 0, applied: 0, measured: 0, courses: 0 }
  const courseNames = useMemo(() => new Map((courses || []).map((course: any) => [clean(course.course_uuid), course.name])), [courses])
  const grouped = useMemo(() => {
    const map = new Map<string, AppliedLearningEntry[]>()
    entries.forEach((entry) => {
      const key = clean(entry.course_uuid)
      map.set(key, [...(map.get(key) || []), entry])
    })
    return Array.from(map.entries())
  }, [entries])

  const onEntrySaved = (saved: AppliedLearningEntry) => {
    queryClient.setQueryData(['applied-learning', 'portfolio', org?.id], (old: AppliedLearningEntry[] | undefined) => (old || []).map((entry) => entry.entry_uuid === saved.entry_uuid ? saved : entry))
    queryClient.invalidateQueries({ queryKey: ['applied-learning', 'summary', org?.id] })
  }

  return (
    <main className="min-h-[calc(100vh-60px)] bg-[#F7F8FA]">
      <section className="border-b border-black/[0.06] bg-white">
        <div className="mx-auto max-w-7xl px-5 py-10 sm:px-8 lg:px-10">
          <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
            <div>
              <div className="flex items-center gap-3"><span className="h-[3px] w-10 rounded-full" style={{ backgroundColor: RED }} /><span className="text-[10px] font-black uppercase tracking-[0.2em]" style={{ color: RED }}>Your applied learning</span></div>
              <h1 className="mt-4 text-4xl font-black tracking-[-0.05em] sm:text-5xl">What you can do now matters.</h1>
              <p className="mt-4 max-w-2xl text-base leading-7 text-black/55">Your portfolio stacks across courses. Return to any entry after applying it and record the measurable change.</p>
            </div>
            <div className="grid grid-cols-3 gap-2 sm:gap-3">
              {[
                [summary.entries, 'applications', BriefcaseBusiness],
                [summary.applied, 'put to work', Target],
                [summary.measured, 'measured', TrendingUp],
              ].map(([value, label, Icon]: any) => (
                <div key={label} className="min-w-[100px] rounded-2xl bg-[#0B263D] px-4 py-4 text-white sm:min-w-[125px]">
                  <Icon className="h-4 w-4 text-white/55" />
                  <p className="mt-3 text-2xl font-black">{value}</p>
                  <p className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-white/55">{label}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-8 inline-flex rounded-xl bg-black/[0.04] p-1">
            <button onClick={() => setTab('portfolio')} className={`rounded-lg px-4 py-2 text-sm font-extrabold ${tab === 'portfolio' ? 'bg-white text-black shadow-sm' : 'text-black/45'}`}>Portfolio</button>
            <button onClick={() => setTab('capstone')} className={`rounded-lg px-4 py-2 text-sm font-extrabold ${tab === 'capstone' ? 'bg-white text-black shadow-sm' : 'text-black/45'}`}>Build capstone</button>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-5 py-8 sm:px-8 lg:px-10 lg:py-10">
        {tab === 'portfolio' ? (
          portfolioQuery.isLoading ? (
            <div className="h-64 animate-pulse rounded-[24px] bg-black/[0.04]" />
          ) : entries.length === 0 ? (
            <div className="rounded-[28px] border border-dashed border-black/15 bg-white px-6 py-16 text-center">
              <BriefcaseBusiness className="mx-auto h-10 w-10 text-black/20" />
              <h2 className="mt-4 text-2xl font-black">Your portfolio starts inside your course.</h2>
              <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-black/50">After each learning activity, record how you will apply it. Those records will stack here automatically.</p>
            </div>
          ) : (
            <div className="space-y-5">
              {grouped.map(([courseUuid, courseEntries]) => {
                const isOpen = openCourse === null || openCourse === courseUuid
                return (
                  <section key={courseUuid} className="overflow-hidden rounded-[24px] border border-black/[0.08] bg-white">
                    <button onClick={() => setOpenCourse(isOpen && openCourse !== null ? null : courseUuid)} className="flex w-full items-center justify-between gap-4 px-5 py-5 text-left sm:px-6">
                      <div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#0B263D] text-white"><Layers3 className="h-5 w-5" /></span><div><p className="text-lg font-black">{courseNames.get(courseUuid) || 'Course'}</p><p className="text-xs text-black/45">{courseEntries.length} applied learning {courseEntries.length === 1 ? 'entry' : 'entries'}</p></div></div>
                      <ChevronDown className={`h-5 w-5 text-black/35 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                    </button>
                    {isOpen && (
                      <div className="border-t border-black/[0.06] px-4 py-4 sm:px-6">
                        <div className="space-y-3">
                          {courseEntries.map((entry) => (
                            <article key={entry.entry_uuid} className="rounded-2xl border border-black/[0.07] bg-[#FAFAFA] p-4 sm:p-5">
                              <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.1em] text-white" style={{ backgroundColor: entry.application_status === 'measured' ? NAVY : RED }}>{statusLabel(entry.application_status)}</span>
                                    {entry.module_name && <span className="text-xs font-semibold text-black/40">{entry.module_name}</span>}
                                    <span className="text-xs text-black/35">{dateLabel(entry.updated_at)}</span>
                                  </div>
                                  <h3 className="mt-3 text-base font-black">{entry.activity_name || 'Learning application'}</h3>
                                  <p className="mt-2 text-sm leading-6 text-black/60"><strong className="text-black/75">I will apply:</strong> {entry.planned_application}</p>
                                  {entry.previous_application && <p className="mt-2 text-sm leading-6 text-black/60"><strong className="text-black/75">I applied:</strong> {entry.previous_application}</p>}
                                  {entry.measurable_change && <div className="mt-3 rounded-xl bg-white p-3 text-sm leading-6 text-[#0B263D]"><strong>Recorded change:</strong> {entry.measurable_change}</div>}
                                </div>
                                <button onClick={() => setEditing(entry)} className="shrink-0 rounded-xl border border-black/10 bg-white px-4 py-2.5 text-xs font-extrabold text-[#0B263D]">Update result</button>
                              </div>
                            </article>
                          ))}
                        </div>
                      </div>
                    )}
                  </section>
                )
              })}
            </div>
          )
        ) : (
          <CapstoneBuilder entries={entries} orgId={org?.id} existing={capstonesQuery.data?.[0] || null} onSaved={() => queryClient.invalidateQueries({ queryKey: ['applied-learning', 'capstones', org?.id] })} />
        )}
      </section>

      {editing && <EntryEditor entry={editing} onClose={() => setEditing(null)} onSaved={onEntrySaved} />}
    </main>
  )
}
