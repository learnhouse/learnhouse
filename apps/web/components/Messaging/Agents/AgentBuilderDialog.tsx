'use client'

import React, { Suspense, lazy, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
  createAgent,
  deleteAgent,
  updateAgent,
} from '@services/messaging/messaging'
import AgentAvatar from './AgentAvatar'
import { TONES } from './agentText'
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

// `id` names the preset's label under messaging.agent_builder.presets.
export const GRADIENT_PRESETS: { id: string; color: string; secondary: string }[] = [
  { id: 'ink', color: '#111827', secondary: '#4b5563' },
  { id: 'indigo', color: '#4f46e5', secondary: '#a855f7' },
  { id: 'ocean', color: '#0ea5e9', secondary: '#2563eb' },
  { id: 'mint', color: '#10b981', secondary: '#06b6d4' },
  { id: 'lime', color: '#84cc16', secondary: '#16a34a' },
  { id: 'sun', color: '#f59e0b', secondary: '#ef4444' },
  { id: 'peach', color: '#fb923c', secondary: '#f472b6' },
  { id: 'rose', color: '#e11d48', secondary: '#9333ea' },
  { id: 'grape', color: '#7c3aed', secondary: '#db2777' },
  { id: 'slate', color: '#334155', secondary: '#0ea5e9' },
]

// Label under messaging.agent_builder.templates.<id>, inserted text under <id>_text.
const INSTRUCTION_TEMPLATES = ['quiz_me', 'french', 'eli12', 'exam_coach'] as const

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
  const { t } = useTranslation()
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
        aria-label={t('messaging.agent_builder.color_hex', { label })}
      />
    </div>
  )
}

function ChatPreview({ draft, isDefault = false }: { draft: Draft; isDefault?: boolean }) {
  const { t } = useTranslation()
  const avatarName = draft.name || t('messaging.agent')
  return (
    <div className="h-full flex flex-col rounded-xl bg-white nice-shadow overflow-hidden">
      <div className="px-4 py-4 border-b border-gray-100">
        <div className="flex items-center gap-3">
          <AgentAvatar agent={{ ...draft, name: avatarName, is_default: isDefault }} size={44} />
          <div className="min-w-0">
            <p className="text-base font-bold leading-tight text-gray-900 truncate">{draft.name || t('messaging.agent_builder.preview_name')}</p>
            <p className="text-xs text-gray-500 line-clamp-2">{draft.description || t('messaging.agent_builder.preview_description')}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-1 mt-3">
          <span className="rounded-md bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-gray-600">{t(`messaging.agent_tones.${draft.tone}`)}</span>
          <span className="rounded-md bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-gray-600">
            {draft.knowledge_mode === 'general' ? t('messaging.agent_general') : t('messaging.agent_builder.course_only')}
          </span>
        </div>
      </div>
      <div className="flex-1 p-4 space-y-3 overflow-y-auto bg-gray-50/60">
        <div className="flex items-end gap-2">
          <AgentAvatar agent={{ ...draft, name: avatarName, is_default: isDefault }} size={26} />
          <div className="max-w-[85%] rounded-xl rounded-es-sm bg-white border border-gray-200 px-3 py-2 text-sm text-gray-800 leading-relaxed">
            {draft.greeting || t('messaging.agent_builder.preview_greeting')}
          </div>
        </div>
        <div className="flex justify-end">
          <div className="max-w-[80%] rounded-xl rounded-ee-sm bg-gray-900 px-3 py-2 text-sm text-white">
            {draft.starters[0] || t('messaging.agent_builder.preview_question')}
          </div>
        </div>
        <div className="flex items-end gap-2">
          <AgentAvatar agent={{ ...draft, name: avatarName, is_default: isDefault }} size={26} />
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
  const { t } = useTranslation()
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
      setError(e?.message || t('messaging.agent_builder.save_failed'))
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
      setError(e?.message || t('messaging.agent_builder.delete_failed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[96vw] max-w-[980px] max-h-[92vh] p-0 overflow-hidden flex flex-col">
        <div className="px-5 py-4 border-b border-gray-100">
          <DialogTitle className="text-xl font-semibold text-gray-900">
            {editing ? t('messaging.agent_builder.title_edit', { name: agent?.name }) : t('messaging.agent_builder.title_create')}
          </DialogTitle>
          <DialogDescription className="text-sm text-gray-500">
            {t('messaging.agent_builder.subtitle')}
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
                      aria-label={t('messaging.agent_builder.pick_emoji')}
                    >
                      <AgentAvatar agent={{ ...draft, name: draft.name || t('messaging.agent'), is_default: isDefault }} size={56} />
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
                    placeholder={t('messaging.agent_builder.name_placeholder')}
                    className={`${inputCls} text-base font-semibold`}
                    autoFocus={!editing}
                  />
                )}
                <input
                  value={draft.description}
                  onChange={(e) => set('description', e.target.value.slice(0, 280))}
                  placeholder={t('messaging.agent_builder.description_placeholder')}
                  className={inputCls}
                />
              </div>
            </div>

            {!isDefault && (
            <Field label={t('messaging.agent_builder.colors')}>
              <div className="flex flex-wrap gap-2">
                {GRADIENT_PRESETS.map((p) => {
                  const active = p.color === draft.color && p.secondary === draft.secondary_color
                  return (
                    <button
                      key={p.id}
                      type="button"
                      title={t(`messaging.agent_builder.presets.${p.id}`)}
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
                <ColorInput key={draft.color} label={t('messaging.agent_builder.main_color')} value={draft.color} onChange={(v) => set('color', v)} />
                <ColorInput key={draft.secondary_color} label={t('messaging.agent_builder.second_color')} value={draft.secondary_color} onChange={(v) => set('secondary_color', v)} />
              </div>
            </Field>
            )}

            <Field label={t('messaging.agent_builder.tone')}>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5">
                {TONES.map((tone) => (
                  <button
                    key={tone}
                    type="button"
                    onClick={() => set('tone', tone)}
                    className={`rounded-lg border px-2.5 py-2 text-xs font-semibold transition-colors ${
                      draft.tone === tone
                        ? 'border-gray-900 bg-gray-900 text-white'
                        : 'border-gray-200 text-gray-700 hover:border-gray-400'
                    }`}
                  >
                    {t(`messaging.agent_tones.${tone}`)}
                  </button>
                ))}
              </div>
              <p className="text-xs text-gray-500">{TONES.includes(draft.tone) ? t(`messaging.agent_tone_hints.${draft.tone}`) : null}</p>
            </Field>

            {isDefault ? (
              <Field label={t('messaging.agent_builder.knowledge')}>
                <div className="flex items-start gap-3 rounded-xl border border-gray-200 px-3.5 py-3">
                  <GlobeSimple size={18} className="mt-0.5 shrink-0 text-gray-500" />
                  <p className="text-sm text-gray-600">
                    <span className="font-semibold text-gray-900">{t('messaging.agent_builder.copilot_knowledge_title')}</span>{' '}
                    {t('messaging.agent_builder.copilot_knowledge_desc', { name: draft.name })}
                  </p>
                </div>
              </Field>
            ) : (
            <Field label={t('messaging.agent_builder.knowledge')}>
              <div className="grid sm:grid-cols-2 gap-2">
                {([
                  { value: 'course_only', label: t('messaging.agent_builder.course_only'), hint: t('messaging.agent_builder.course_only_hint'), Icon: BookOpen },
                  { value: 'general', label: t('messaging.agent_general'), hint: t('messaging.agent_builder.general_hint'), Icon: GlobeSimple },
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
              <Field label={t('messaging.agent_builder.courses')}>
                <div className="flex items-start gap-3 rounded-xl border border-gray-200 px-3.5 py-3">
                  <BookOpen size={18} className="mt-0.5 shrink-0 text-gray-500" />
                  <p className="text-sm text-gray-600">
                    <span className="font-semibold text-gray-900">{t('messaging.agent_builder.copilot_courses_title')}</span>{' '}
                    {t('messaging.agent_builder.copilot_courses_desc', { name: draft.name })}
                  </p>
                </div>
              </Field>
            ) : (
            <Field
              label={t('messaging.agent_builder.courses')}
              hint={
                draft.course_uuids.length
                  ? t('messaging.selected', { count: draft.course_uuids.length })
                  : t('messaging.agent_builder.courses_all_hint')
              }
            >
              <div className="rounded-xl border border-gray-200 overflow-hidden">
                <div className="flex items-center gap-2 px-3 border-b border-gray-100">
                  <MagnifyingGlass size={14} className="text-gray-400" />
                  <input
                    value={courseQuery}
                    onChange={(e) => setCourseQuery(e.target.value)}
                    placeholder={t('messaging.agent_builder.search_courses')}
                    className="w-full py-2 text-sm focus:outline-none bg-transparent"
                  />
                  {draft.course_uuids.length > 0 && (
                    <button type="button" onClick={() => set('course_uuids', [])} className="text-xs font-semibold text-gray-500 hover:text-gray-900 whitespace-nowrap">
                      {t('messaging.clear')}
                    </button>
                  )}
                </div>
                <div className="max-h-40 overflow-y-auto py-1">
                  {filteredCourses.length === 0 && <p className="px-3 py-3 text-xs text-gray-400">{t('messaging.agent_builder.no_courses')}</p>}
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

            <Field label={t('messaging.agent_builder.instructions')} hint={t('messaging.agent_builder.instructions_hint')}>
              <textarea
                value={draft.instructions}
                onChange={(e) => set('instructions', e.target.value.slice(0, 4000))}
                rows={4}
                placeholder={t('messaging.agent_builder.instructions_placeholder')}
                className={`${inputCls} resize-y min-h-[96px]`}
              />
              <div className="flex flex-wrap gap-1.5">
                {INSTRUCTION_TEMPLATES.map((tpl) => (
                  <button
                    key={tpl}
                    type="button"
                    onClick={() =>
                      set(
                        'instructions',
                        (draft.instructions ? draft.instructions.trimEnd() + '\n' : '') + t(`messaging.agent_builder.templates.${tpl}_text`)
                      )
                    }
                    className="inline-flex items-center gap-1 rounded-full border border-dashed border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-600 hover:border-gray-900 hover:text-gray-900"
                  >
                    <Plus size={10} weight="bold" />
                    {t(`messaging.agent_builder.templates.${tpl}`)}
                  </button>
                ))}
              </div>
            </Field>

            <Field label={t('messaging.agent_builder.greeting')} hint={t('messaging.agent_builder.greeting_hint')}>
              <input
                value={draft.greeting}
                onChange={(e) => set('greeting', e.target.value.slice(0, 500))}
                placeholder={t('messaging.agent_builder.greeting_placeholder')}
                className={inputCls}
              />
            </Field>

            <Field label={t('messaging.agent_builder.starters')} hint={`${draft.starters.length}/6`}>
              {draft.starters.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {draft.starters.map((s, i) => (
                    <span key={i} className="inline-flex items-center gap-1 rounded-full bg-gray-100 ps-2.5 pe-1 py-1 text-xs text-gray-700">
                      {s}
                      <button
                        type="button"
                        onClick={() => set('starters', draft.starters.filter((_, j) => j !== i))}
                        className="p-0.5 rounded-full hover:bg-gray-200"
                        aria-label={t('messaging.agent_builder.remove_starter')}
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
                    placeholder={t('messaging.agent_builder.starter_placeholder')}
                    className={inputCls}
                  />
                  <button
                    type="button"
                    onClick={addStarter}
                    className="rounded-lg border border-gray-200 px-3 text-sm font-semibold text-gray-700 hover:border-gray-900"
                  >
                    {t('messaging.add')}
                  </button>
                </div>
              )}
            </Field>

            {canShare && (
              <Field label={t('messaging.agent_builder.visibility')}>
                <div className="grid grid-cols-2 gap-2">
                  {([
                    { value: 'private', label: t('messaging.agent_builder.only_me'), Icon: LockSimple },
                    { value: 'org', label: t('messaging.agent_builder.everyone'), Icon: UsersThree },
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
              {t('messaging.agent_builder.preview')}
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
                  <span className="text-gray-600">{t('messaging.agent_builder.delete_confirm')}</span>
                  <button type="button" onClick={remove} disabled={saving} className="font-semibold text-red-600 hover:text-red-700">
                    {t('messaging.delete')}
                  </button>
                  <button type="button" onClick={() => setConfirmDelete(false)} className="font-semibold text-gray-500">
                    {t('common.cancel')}
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-red-600"
                >
                  <Trash size={14} />
                  {t('messaging.delete')}
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
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={save}
              disabled={!valid || saving}
              className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-40"
            >
              {saving && <SpinnerGap size={14} className="animate-spin" />}
              {editing ? t('messaging.agent_builder.save') : t('messaging.agent_builder.create')}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
