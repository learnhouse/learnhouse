'use client'
import React, { useEffect, useRef, useState } from 'react'
import { Loader2, UserRound } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import EditorPreview from '@components/Objects/Editor/EditorPreview'
import { useAuth } from '@components/Contexts/AuthContext'
import {
  DynamicPreviewResult,
  PreviewPersona,
  getDynamicPreview,
} from '@services/courses/dynamicContent'
import { ROLES } from './dynamicRules'
import { useDynamicLookups } from './useDynamicLookups'

const DEFAULT_PERSONA: PreviewPersona = {
  signed_in: true,
  first_name: null,
  last_name: null,
  role: 'member',
  usergroup_uuids: [],
  locale: 'en',
  enrolled: true,
  days_enrolled: 0,
  progress_percent: 0,
  completed_activity_uuids: [],
  today: null,
}

interface ViewAsPreviewProps {
  activity: any
  // Unsaved editor document, read when the modal opens and on refresh.
  getContent: () => any
  onClose: () => void
}

// "View as": render the page through the API exactly as a chosen kind of
// learner would receive it, unsaved changes included.
export default function ViewAsPreview({ activity, getContent, onClose }: ViewAsPreviewProps) {
  const { t, i18n } = useTranslation()
  const { accessToken } = useAuth()
  const lookups = useDynamicLookups()
  const [persona, setPersona] = useState<PreviewPersona>(() => ({ ...DEFAULT_PERSONA, locale: i18n.language || 'en' }))
  const [result, setResult] = useState<DynamicPreviewResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const content = useRef(getContent())
  const requestId = useRef(0)

  useEffect(() => {
    if (!accessToken) return
    const id = ++requestId.current
    const timer = window.setTimeout(async () => {
      setLoading(true)
      const res = await getDynamicPreview(activity.activity_uuid, content.current, persona, accessToken)
      if (id !== requestId.current) return
      setLoading(false)
      if (res.success) {
        setResult(res.data)
        setError(null)
      } else {
        setError(res.data?.detail || t('editor.dynamic.preview_error', 'Could not render the preview.'))
      }
    }, 250)
    return () => window.clearTimeout(timer)
  }, [persona, accessToken, activity.activity_uuid, t])

  const set = <K extends keyof PreviewPersona>(key: K, value: PreviewPersona[K]) =>
    setPersona((p) => ({ ...p, [key]: value }))

  const toggle = (key: 'usergroup_uuids' | 'completed_activity_uuids', value: string) =>
    setPersona((p) => ({
      ...p,
      [key]: p[key].includes(value) ? p[key].filter((v) => v !== value) : [...p[key], value],
    }))

  const signedIn = persona.signed_in && persona.role !== 'anonymous'

  const sidebar = (
    <div className="w-full shrink-0 space-y-4 overflow-y-auto border-gray-100 p-4 text-sm md:w-72 md:border-e">
      <Field label={t('editor.dynamic.persona.role', 'Viewer')}>
        <select
          className="w-full rounded-lg border border-gray-200 px-2 py-1.5"
          value={signedIn ? persona.role : 'anonymous'}
          onChange={(e) => {
            const role = e.target.value as PreviewPersona['role']
            setPersona((p) => ({ ...p, role, signed_in: role !== 'anonymous' }))
          }}
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>{t(`editor.dynamic.roles.${r}`, r)}</option>
          ))}
        </select>
      </Field>

      {signedIn && (
        <>
          <Field label={t('editor.dynamic.persona.first_name', 'First name')}>
            <input
              className="w-full rounded-lg border border-gray-200 px-2 py-1.5"
              value={persona.first_name ?? ''}
              placeholder={t('editor.dynamic.persona.your_name', 'Your own')}
              onChange={(e) => set('first_name', e.target.value || null)}
            />
          </Field>

          <Field label={t('editor.dynamic.fields.user_groups', 'User group')}>
            {lookups.usergroups.length === 0 ? (
              <p className="text-xs text-gray-400">{t('editor.dynamic.no_usergroups', 'This organization has no user groups.')}</p>
            ) : (
              <Chips
                options={lookups.usergroups}
                selected={persona.usergroup_uuids}
                onToggle={(v) => toggle('usergroup_uuids', v)}
              />
            )}
          </Field>

          <label className="flex items-center gap-2">
            <input type="checkbox" checked={persona.enrolled} onChange={(e) => set('enrolled', e.target.checked)} />
            {t('editor.dynamic.fields.course_enrolled', 'Enrolled in course')}
          </label>

          {persona.enrolled && (
            <Field label={`${t('editor.dynamic.fields.enrollment_days', 'Days since enrollment')}: ${persona.days_enrolled ?? 0}`}>
              <input type="range" min={0} max={90} className="w-full" value={persona.days_enrolled ?? 0}
                onChange={(e) => set('days_enrolled', Number(e.target.value))} />
            </Field>
          )}

          <Field label={`${t('editor.dynamic.fields.progress_percent', 'Course progress (%)')}: ${persona.progress_percent}%`}>
            <input type="range" min={0} max={100} step={5} className="w-full" value={persona.progress_percent}
              onChange={(e) => set('progress_percent', Number(e.target.value))} />
          </Field>

          {lookups.activities.length > 0 && (
            <Field label={t('editor.dynamic.fields.progress_completed_activities', 'Completed activities')}>
              <Chips
                options={lookups.activities}
                selected={persona.completed_activity_uuids}
                onToggle={(v) => toggle('completed_activity_uuids', v)}
              />
            </Field>
          )}
        </>
      )}

      <Field label={t('editor.dynamic.fields.user_locale', 'Language')}>
        <input className="w-full rounded-lg border border-gray-200 px-2 py-1.5" value={persona.locale} maxLength={16}
          onChange={(e) => set('locale', e.target.value)} />
      </Field>

      <Field label={t('editor.dynamic.fields.date_today', 'Date')}>
        <input type="date" className="w-full rounded-lg border border-gray-200 px-2 py-1.5" value={persona.today ?? ''}
          onChange={(e) => set('today', e.target.value || null)} />
      </Field>
    </div>
  )

  const body = (
    <div className="flex h-[70vh] flex-col md:flex-row">
      {sidebar}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-2 text-xs text-gray-500">
          {loading ? <Loader2 size={13} className="animate-spin" /> : <UserRound size={13} />}
          {result && (
            <span>
              {t('editor.dynamic.preview_stats', {
                shown: result.shown_blocks,
                hidden: result.hidden_blocks,
                defaultValue: '{{shown}} conditional blocks shown, {{hidden}} hidden',
              })}
            </span>
          )}
          {error && <span className="text-red-600">{error}</span>}
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {result && <EditorPreview content={result.content} activity={activity} />}
        </div>
      </div>
    </div>
  )

  return (
    <Modal
      isDialogOpen
      onOpenChange={(open) => !open && onClose()}
      dialogTitle={t('editor.dynamic.view_as', 'View as')}
      dialogDescription={t(
        'editor.dynamic.view_as_description',
        'See this page the way a learner with these details gets it, unsaved changes included.'
      )}
      minWidth="lg"
      noPadding
      dialogContent={body}
    />
  )
}

function Field(props: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-xs font-semibold text-gray-500">{props.label}</div>
      {props.children}
    </div>
  )
}

function Chips(props: { options: { value: string; label: string }[]; selected: string[]; onToggle: (v: string) => void }) {
  return (
    <div className="flex max-h-32 flex-wrap gap-1 overflow-y-auto">
      {props.options.map((o) => {
        const active = props.selected.includes(o.value)
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => props.onToggle(o.value)}
            className={`rounded-full px-2.5 py-1 text-xs ${
              active ? 'bg-violet-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
