'use client'

import React, { Suspense, lazy, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  BookOpen,
  Books,
  Check,
  GlobeSimple,
  LockSimple,
  MagnifyingGlass,
  Plus,
  SpinnerGap,
  Trash,
  UsersThree,
  X,
} from '@phosphor-icons/react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@components/ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@components/ui/popover'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import useAdminStatus from '@components/Hooks/useAdminStatus'
import { messagingKeys } from '@components/Messaging/MessagingProvider'
import { getAllOrgCourses } from '@services/courses/courses'
import { queryKeys } from '@/lib/query/keys'
import {
  type Agent,
  type AgentInput,
  type AgentTone,
  createAgent,
  deleteAgent,
  updateAgent,
} from '@services/messaging/messaging'
import AgentAvatar from './AgentAvatar'
import { useColorScheme } from '@components/Contexts/ColorSchemeContext'

const EmojiPicker = lazy(() => import('@emoji-mart/react'))
const loadEmojiData = async () => (await import('@emoji-mart/data')).default

export type AgentBuilderDialogProps = {
  open: boolean
  onOpenChange: (_open: boolean) => void
  /** Edit this agent; create a new one when omitted. */
  agent?: Agent | null
  orgslug: string
  /** Called with the saved agent. */
  onSaved?: (_agent: Agent) => void
}

export const GRADIENT_PRESETS: { name: string; color: string; secondary: string }[] = [
  { name: 'Ink', color: '#111827', secondary: '#4b5563' },
  { name: 'Indigo', color: '#4f46e5', secondary: '#a855f7' },
  { name: 'Ocean', color: '#0ea5e9', secondary: '#2563eb' },
  { name: 'Mint', color: '#10b981', secondary: '#06b6d4' },
  { name: 'Lime', color: '#84cc16', secondary: '#16a34a' },
  { name: 'Sun', color: '#f59e0b', secondary: '#ef4444' },
  { name: 'Peach', color: '#fb923c', secondary: '#f472b6' },
  { name: 'Rose', color: '#e11d48', secondary: '#9333ea' },
  { name: 'Grape', color: '#7c3aed', secondary: '#db2777' },
  { name: 'Slate', color: '#334155', secondary: '#0ea5e9' },
]

export const TONES: { value: AgentTone; label: string; hint: string }[] = [
  { value: 'friendly', label: 'Friendly', hint: 'Warm and clear, short paragraphs.' },
  { value: 'concise', label: 'Concise', hint: 'Straight to the point, bullets over prose.' },
  { value: 'socratic', label: 'Socratic tutor', hint: 'Guides with questions instead of giving answers away.' },
  { value: 'expert', label: 'Expert', hint: 'Precise terms, depth and nuance.' },
  { value: 'playful', label: 'Playful', hint: 'Upbeat, a little humor, still accurate.' },
]

const INSTRUCTION_TEMPLATES = [
  { label: 'Quiz me after each answer', text: 'After every answer, ask me one short question to check I understood.' },
  { label: 'Answer in French', text: 'Always answer in French, even when I write in another language.' },
  { label: "Explain like I'm 12", text: 'Explain things simply, as you would to a curious 12-year-old, with everyday examples.' },
  { label: 'Exam coach', text: 'Act as an exam coach: focus on what is likely to be tested and point out common mistakes.' },
]

const HEX = /^#[0-9a-fA-F]{6}$/

type Draft = Required<AgentInput>

function toDraft(agent?: Agent | null): Draft {
  return {
    name: agent?.name ?? '',
    description: agent?.description ?? '',
    emoji: agent?.emoji ?? '✨',
    color: agent?.color ?? GRADIENT_PRESETS[1].color,
    secondary_color: agent?.secondary_color ?? GRADIENT_PRESETS[1].secondary,
    instructions: agent?.instructions ?? '',
    tone: agent?.tone ?? 'friendly',
    knowledge_mode: agent?.knowledge_mode ?? 'course_only',
    course_uuids: agent?.course_uuids ?? [],
    greeting: agent?.greeting ?? '',
    starters: agent?.starters ?? [],
    visibility: agent?.visibility ?? 'private',
  }
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <label className="text-sm font-semibold text-gray-900">{label}</label>
        {hint && <span className="text-xs text-gray-400">{hint}</span>}
      </div>
      {children}
    </div>
  )
}

const inputCls =
  'w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-200 focus:border-gray-400 transition'

// Keyed on its value by the caller, so a preset click resets the text field.
function ColorInput({ value, onChange, label }: { value: string; onChange: (_v: string) => void; label: string }) {
  const [text, setText] = useState(value)
  return (
    <div className="flex items-center gap-2 rounded-lg border border-gray-200 px-2 py-1.5 bg-white">
      <label className="relative w-7 h-7 rounded-lg overflow-hidden cursor-pointer ring-1 ring-black/10 shrink-0" style={{ background: value }}>
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="absolute inset-0 opacity-0 cursor-pointer"
          aria-label={label}
        />
      </label>
      <input
        value={text}
        onChange={(e) => {
          const v = e.target.value.startsWith('#') ? e.target.value : `#${e.target.value}`
          setText(v)
          if (HEX.test(v)) onChange(v.toLowerCase())
        }}
        className="w-full text-xs font-mono uppercase text-gray-700 focus:outline-none bg-transparent"
        maxLength={7}
        aria-label={`${label} hex`}
      />
    </div>
  )
}

function ChatPreview({ draft, isDefault = false }: { draft: Draft; isDefault?: boolean }) {
  const tone = TONES.find((t) => t.value === draft.tone)
  return (
    <div className="h-full flex flex-col rounded-xl bg-white nice-shadow overflow-hidden">
      <div className="px-4 py-4 border-b border-gray-100">
        <div className="flex items-center gap-3">
          <AgentAvatar agent={{ ...draft, name: draft.name || 'Agent', is_default: isDefault }} size={44} />
          <div className="min-w-0">
            <p className="text-base font-bold leading-tight text-gray-900 truncate">{draft.name || 'Your agent'}</p>
            <p className="text-xs text-gray-500 line-clamp-2">{draft.description || 'Describe what it helps with.'}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-1 mt-3">
          <span className="rounded-md bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-gray-600">{tone?.label}</span>
          <span className="rounded-md bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-gray-600">
            {draft.knowledge_mode === 'general' ? 'Courses + general knowledge' : 'Course content only'}
          </span>
        </div>
      </div>
      <div className="flex-1 p-4 space-y-3 overflow-y-auto bg-gray-50/60">
        <div className="flex items-end gap-2">
          <AgentAvatar agent={{ ...draft, name: draft.name || 'Agent', is_default: isDefault }} size={26} />
          <div className="max-w-[85%] rounded-xl rounded-es-sm bg-white border border-gray-200 px-3 py-2 text-sm text-gray-800 leading-relaxed">
            {draft.greeting || 'Hi! Ask me anything about your courses.'}
          </div>
        </div>
        <div className="flex justify-end">
          <div className="max-w-[80%] rounded-xl rounded-ee-sm bg-gray-900 px-3 py-2 text-sm text-white">
            {draft.starters[0] || 'Can you explain this lesson?'}
          </div>
        </div>
        <div className="flex items-end gap-2">
          <AgentAvatar agent={{ ...draft, name: draft.name || 'Agent', is_default: isDefault }} size={26} />
          <div className="rounded-xl rounded-es-sm bg-white border border-gray-200 px-3 py-2.5">
            <span className="inline-flex gap-1">
              {[0, 150, 300].map((d) => (
                <span key={d} className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: `${d}ms` }} />
              ))}
            </span>
          </div>
        </div>
        {draft.starters.length > 0 && (
          <div className="pt-1 flex flex-wrap gap-1.5">
            {draft.starters.slice(0, 4).map((s, i) => (
              <span key={i} className="text-xs px-2.5 py-1 rounded-lg border border-gray-200 bg-white text-gray-700">
                {s}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default function AgentBuilderDialog({ open, onOpenChange, agent, orgslug, onSaved }: AgentBuilderDialogProps) {
  const { colorScheme } = useColorScheme()
  const org = useOrg() as any
  const session = useLHSession() as any
  const token: string | undefined = session?.data?.tokens?.access_token
  const { isAdmin } = useAdminStatus()
  const qc = useQueryClient()
  const editing = Boolean(agent)
  const [draft, setDraft] = useState<Draft>(() => toDraft(agent))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [courseQuery, setCourseQuery] = useState('')
  const [starterInput, setStarterInput] = useState('')

  // Start from the agent (or a blank one) each time the dialog opens.
  const openKey = open ? `open:${agent?.agent_uuid ?? 'new'}` : 'closed'
  const [seenKey, setSeenKey] = useState(openKey)
  if (openKey !== seenKey) {
    setSeenKey(openKey)
    if (open) {
      setDraft(toDraft(agent))
      setError(null)
      setConfirmDelete(false)
      setStarterInput('')
      setCourseQuery('')
    }
  }

  const { data: coursesData } = useQuery({
    queryKey: queryKeys.courses.list(orgslug),
    queryFn: () => getAllOrgCourses(orgslug, token, false),
    enabled: open && Boolean(token && orgslug),
    staleTime: 60_000,
  })
  const courses: any[] = useMemo(() => (Array.isArray(coursesData) ? coursesData : []), [coursesData])
  const filteredCourses = useMemo(() => {
    const q = courseQuery.trim().toLowerCase()
    return q ? courses.filter((c) => c.name?.toLowerCase().includes(q)) : courses
  }, [courses, courseQuery])

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }))

  const toggleCourse = (uuid: string) =>
    set(
      'course_uuids',
      draft.course_uuids.includes(uuid) ? draft.course_uuids.filter((c) => c !== uuid) : [...draft.course_uuids, uuid]
    )

  const addStarter = () => {
    const s = starterInput.trim()
    if (!s || draft.starters.length >= 6) return
    set('starters', [...draft.starters, s.slice(0, 120)])
    setStarterInput('')
  }

  const isDefault = Boolean(agent?.is_default)
  const canShare = Boolean(isAdmin) && !isDefault
  const valid = draft.name.trim().length > 0 && HEX.test(draft.color) && HEX.test(draft.secondary_color)

  const save = async () => {
    if (!token || !org?.id || !valid) return
    setSaving(true)
    setError(null)
    try {
      const body: AgentInput = { ...draft, name: draft.name.trim() }
      if (!canShare && !editing) body.visibility = 'private'
      // Copilot keeps its LearnHouse AI identity and reads every course.
      if (isDefault) for (const k of ['visibility', 'name', 'emoji', 'color', 'secondary_color', 'course_uuids', 'knowledge_mode']) delete (body as any)[k]
      const saved = editing && agent
        ? await updateAgent(agent.agent_uuid, body, token)
        : await createAgent(org.id, body, token)
      await qc.invalidateQueries({ queryKey: messagingKeys.agents(org.id) })
      onSaved?.(saved)
      onOpenChange(false)
    } catch (e: any) {
      setError(e?.message || 'Could not save the agent')
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!agent || !token || !org?.id) return
    setSaving(true)
    setError(null)
    try {
      await deleteAgent(agent.agent_uuid, token)
      await qc.invalidateQueries({ queryKey: messagingKeys.agents(org.id) })
      onOpenChange(false)
    } catch (e: any) {
      setError(e?.message || 'Could not delete the agent')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[96vw] max-w-[980px] max-h-[92vh] p-0 overflow-hidden flex flex-col">
        <div className="px-5 py-4 border-b border-gray-100">
          <DialogTitle className="text-xl font-semibold text-gray-900">
            {editing ? `Edit ${agent?.name}` : 'Create an agent'}
          </DialogTitle>
          <DialogDescription className="text-sm text-gray-500">
            An assistant with its own personality that answers from your courses.
          </DialogDescription>
        </div>

        <div className="flex-1 min-h-0 grid md:grid-cols-[1fr_340px]">
          {/* Form */}
          <div className="overflow-y-auto px-6 py-5 space-y-5">
            <div className="flex gap-3">
              {isDefault ? (
                <AgentAvatar agent={{ ...draft, is_default: true }} size={56} />
              ) : (
              <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="rounded-[16px] ring-1 ring-gray-200 hover:ring-gray-400 transition shrink-0"
                      aria-label="Pick an emoji"
                    >
                      <AgentAvatar agent={{ ...draft, name: draft.name || 'Agent', is_default: isDefault }} size={56} />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0 border-none shadow-xl" align="start">
                    <Suspense fallback={<div className="w-[352px] h-[435px] flex items-center justify-center"><SpinnerGap className="animate-spin" /></div>}>
                      <EmojiPicker
                        data={loadEmojiData}
                        theme={colorScheme}
                        previewPosition="none"
                        onEmojiSelect={(e: any) => {
                          set('emoji', e.native)
                          setEmojiOpen(false)
                        }}
                      />
                    </Suspense>
                  </PopoverContent>
                </Popover>
              )}
              <div className="flex-1 space-y-2">
                {isDefault ? (
                  <p className="px-1 pt-1.5 text-base font-semibold text-gray-900">{draft.name}</p>
                ) : (
                  <input
                    value={draft.name}
                    onChange={(e) => set('name', e.target.value.slice(0, 60))}
                    placeholder="Name, e.g. Quizzy"
                    className={`${inputCls} text-base font-semibold`}
                    autoFocus={!editing}
                  />
                )}
                <input
                  value={draft.description}
                  onChange={(e) => set('description', e.target.value.slice(0, 280))}
                  placeholder="What does it help with?"
                  className={inputCls}
                />
              </div>
            </div>

            {!isDefault && (
            <Field label="Colors">
              <div className="flex flex-wrap gap-2">
                {GRADIENT_PRESETS.map((p) => {
                  const active = p.color === draft.color && p.secondary === draft.secondary_color
                  return (
                    <button
                      key={p.name}
                      type="button"
                      title={p.name}
                      onClick={() => setDraft((d) => ({ ...d, color: p.color, secondary_color: p.secondary }))}
                      className={`w-8 h-8 rounded-lg ${active ? 'ring-2 ring-offset-2 ring-gray-900' : 'ring-1 ring-black/10'}`}
                      style={{ background: `linear-gradient(140deg, ${p.color}, ${p.secondary})` }}
                    >
                      {active && <Check size={14} weight="bold" className="text-white mx-auto" />}
                    </button>
                  )
                })}
              </div>
              <div className="grid grid-cols-2 gap-2 pt-1">
                <ColorInput key={draft.color} label="Main color" value={draft.color} onChange={(v) => set('color', v)} />
                <ColorInput key={draft.secondary_color} label="Second color" value={draft.secondary_color} onChange={(v) => set('secondary_color', v)} />
              </div>
            </Field>
            )}

            <Field label="Tone">
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5">
                {TONES.map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => set('tone', t.value)}
                    className={`rounded-lg border px-2.5 py-2 text-xs font-semibold transition-colors ${
                      draft.tone === t.value
                        ? 'border-gray-900 bg-gray-900 text-white'
                        : 'border-gray-200 text-gray-700 hover:border-gray-400'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-gray-500">{TONES.find((t) => t.value === draft.tone)?.hint}</p>
            </Field>

            {isDefault ? (
              <Field label="Knowledge">
                <div className="flex items-start gap-3 rounded-xl border border-gray-200 px-3.5 py-3">
                  <GlobeSimple size={18} className="mt-0.5 shrink-0 text-gray-500" />
                  <p className="text-sm text-gray-600">
                    <span className="font-semibold text-gray-900">Courses + general knowledge.</span> Copilot answers from your courses first and fills in from its own knowledge, clearly marked.
                  </p>
                </div>
              </Field>
            ) : (
            <Field label="Knowledge">
              <div className="grid sm:grid-cols-2 gap-2">
                {([
                  { value: 'course_only', label: 'Course content only', hint: 'Sticks to what your courses say.', Icon: BookOpen },
                  { value: 'general', label: 'Courses + general knowledge', hint: 'Adds its own knowledge, clearly marked.', Icon: GlobeSimple },
                ] as const).map((k) => (
                  <button
                    key={k.value}
                    type="button"
                    onClick={() => set('knowledge_mode', k.value)}
                    className={`flex items-start gap-2.5 text-start rounded-lg border p-3 transition-colors ${
                      draft.knowledge_mode === k.value ? 'border-gray-900 bg-gray-50' : 'border-gray-200 hover:border-gray-400'
                    }`}
                  >
                    <k.Icon size={18} weight="duotone" className="shrink-0 mt-0.5 text-gray-700" />
                    <span>
                      <span className="block text-sm font-semibold text-gray-900">{k.label}</span>
                      <span className="block text-xs text-gray-500">{k.hint}</span>
                    </span>
                  </button>
                ))}
              </div>
            </Field>
            )}

            {isDefault ? (
              <Field label="Courses it reads">
                <div className="flex items-start gap-3 rounded-xl border border-gray-200 px-3.5 py-3">
                  <BookOpen size={18} className="mt-0.5 shrink-0 text-gray-500" />
                  <p className="text-sm text-gray-600">
                    <span className="font-semibold text-gray-900">Every course.</span> Copilot reads all the courses the person chatting can open, and connects them in its answers.
                  </p>
                </div>
              </Field>
            ) : (
            <Field
              label="Courses it reads"
              hint={draft.course_uuids.length ? `${draft.course_uuids.length} selected` : 'All courses the person chatting can open'}
            >
              <div className="rounded-xl border border-gray-200 overflow-hidden">
                <div className="flex items-center gap-2 px-3 border-b border-gray-100">
                  <MagnifyingGlass size={14} className="text-gray-400" />
                  <input
                    value={courseQuery}
                    onChange={(e) => setCourseQuery(e.target.value)}
                    placeholder="Search courses"
                    className="w-full py-2 text-sm focus:outline-none bg-transparent"
                  />
                  {draft.course_uuids.length > 0 && (
                    <button type="button" onClick={() => set('course_uuids', [])} className="text-xs font-semibold text-gray-500 hover:text-gray-900 whitespace-nowrap">
                      Clear
                    </button>
                  )}
                </div>
                <div className="max-h-40 overflow-y-auto py-1">
                  {filteredCourses.length === 0 && <p className="px-3 py-3 text-xs text-gray-400">No courses found.</p>}
                  {filteredCourses.map((c) => {
                    const on = draft.course_uuids.includes(c.course_uuid)
                    return (
                      <button
                        key={c.course_uuid}
                        type="button"
                        onClick={() => toggleCourse(c.course_uuid)}
                        className="w-full flex items-center gap-2.5 px-3 py-1.5 text-start hover:bg-gray-50"
                      >
                        <span className={`inline-flex items-center justify-center w-4 h-4 rounded-[5px] border ${on ? 'bg-gray-900 border-gray-900 text-white' : 'border-gray-300'}`}>
                          {on && <Check size={10} weight="bold" />}
                        </span>
                        <Books size={14} weight="duotone" className="text-gray-400 shrink-0" />
                        <span className="text-sm text-gray-800 truncate">{c.name}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            </Field>
            )}

            <Field label="Instructions" hint="Only you and admins see these">
              <textarea
                value={draft.instructions}
                onChange={(e) => set('instructions', e.target.value.slice(0, 4000))}
                rows={4}
                placeholder="How should it behave? What should it always or never do?"
                className={`${inputCls} resize-y min-h-[96px]`}
              />
              <div className="flex flex-wrap gap-1.5">
                {INSTRUCTION_TEMPLATES.map((tpl) => (
                  <button
                    key={tpl.label}
                    type="button"
                    onClick={() => set('instructions', (draft.instructions ? draft.instructions.trimEnd() + '\n' : '') + tpl.text)}
                    className="inline-flex items-center gap-1 rounded-full border border-dashed border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-600 hover:border-gray-900 hover:text-gray-900"
                  >
                    <Plus size={10} weight="bold" />
                    {tpl.label}
                  </button>
                ))}
              </div>
            </Field>

            <Field label="Greeting" hint="First message in a new chat">
              <input
                value={draft.greeting}
                onChange={(e) => set('greeting', e.target.value.slice(0, 500))}
                placeholder="Hi! What are we learning today?"
                className={inputCls}
              />
            </Field>

            <Field label="Conversation starters" hint={`${draft.starters.length}/6`}>
              {draft.starters.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {draft.starters.map((s, i) => (
                    <span key={i} className="inline-flex items-center gap-1 rounded-full bg-gray-100 ps-2.5 pe-1 py-1 text-xs text-gray-700">
                      {s}
                      <button
                        type="button"
                        onClick={() => set('starters', draft.starters.filter((_, j) => j !== i))}
                        className="p-0.5 rounded-full hover:bg-gray-200"
                        aria-label="Remove starter"
                      >
                        <X size={10} weight="bold" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              {draft.starters.length < 6 && (
                <div className="flex gap-2">
                  <input
                    value={starterInput}
                    onChange={(e) => setStarterInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        addStarter()
                      }
                    }}
                    placeholder="e.g. Quiz me on chapter 2"
                    className={inputCls}
                  />
                  <button
                    type="button"
                    onClick={addStarter}
                    className="rounded-lg border border-gray-200 px-3 text-sm font-semibold text-gray-700 hover:border-gray-900"
                  >
                    Add
                  </button>
                </div>
              )}
            </Field>

            {canShare && (
              <Field label="Who can chat with it">
                <div className="grid grid-cols-2 gap-2">
                  {([
                    { value: 'private', label: 'Only me', Icon: LockSimple },
                    { value: 'org', label: 'Everyone in the org', Icon: UsersThree },
                  ] as const).map((v) => (
                    <button
                      key={v.value}
                      type="button"
                      onClick={() => set('visibility', v.value)}
                      className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-semibold transition-colors ${
                        draft.visibility === v.value ? 'border-gray-900 bg-gray-50 text-gray-900' : 'border-gray-200 text-gray-600 hover:border-gray-400'
                      }`}
                    >
                      <v.Icon size={15} weight="bold" />
                      {v.label}
                    </button>
                  ))}
                </div>
              </Field>
            )}
          </div>

          {/* Preview */}
          <div className="hidden md:block border-s border-gray-100 bg-gray-50/40 p-4">
            <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-2 flex items-center gap-1.5">
              Preview
            </p>
            <div className="h-[calc(100%-1.5rem)]">
              <ChatPreview draft={draft} isDefault={isDefault} />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-gray-100 bg-white">
          <div className="min-w-0 flex items-center gap-2">
            {editing && agent?.can_edit && !isDefault && (
              confirmDelete ? (
                <span className="flex items-center gap-2 text-xs">
                  <span className="text-gray-600">Delete for good?</span>
                  <button type="button" onClick={remove} disabled={saving} className="font-semibold text-red-600 hover:text-red-700">
                    Delete
                  </button>
                  <button type="button" onClick={() => setConfirmDelete(false)} className="font-semibold text-gray-500">
                    Cancel
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-red-600"
                >
                  <Trash size={14} />
                  Delete
                </button>
              )
            )}
            {error && <p className="text-xs text-red-600 truncate">{error}</p>}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded-lg px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-100"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={!valid || saving}
              className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-40"
            >
              {saving && <SpinnerGap size={14} className="animate-spin" />}
              {editing ? 'Save changes' : 'Create agent'}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
