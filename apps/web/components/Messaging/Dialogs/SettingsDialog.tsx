'use client'

import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import dayjs from 'dayjs'
import { Bell, EnvelopeSimple, Eye, GearSix, ShieldCheck, Smiley } from '@phosphor-icons/react'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import { Button, INPUT, ToolbarSelect } from '@components/Dashboard/Shared/DashKit/DashKit'
import { Switch } from '@components/ui/switch'
import { useMessaging } from '@components/Messaging/MessagingProvider'
import EmojiPickerPopover from '@components/Messaging/ui/EmojiPicker'
import { Availability, EmailMode, MyStatus, getMe, updateMe } from '@services/messaging/messaging'
import { PRESENCE_DOT } from '@components/Messaging/utils'

const PRESETS = [
  { emoji: '📚', text: 'Studying' },
  { emoji: '🍔', text: 'Lunch' },
  { emoji: '🎧', text: 'Focusing' },
  { emoji: '🤒', text: 'Out sick' },
  { emoji: '🌴', text: 'Vacation' },
]

const CLEAR_AFTER = [
  { key: '30m', label: '30 minutes', at: () => dayjs().add(30, 'minute') },
  { key: '1h', label: '1 hour', at: () => dayjs().add(1, 'hour') },
  { key: '4h', label: '4 hours', at: () => dayjs().add(4, 'hour') },
  { key: 'today', label: 'Today', at: () => dayjs().endOf('day') },
  { key: 'never', label: "Don't clear", at: () => null },
] as const

export const AVAILABILITY: { key: Availability; label: string; hint: string; dot: string }[] = [
  { key: 'auto', label: 'Automatic', hint: 'Online while Messages is open', dot: PRESENCE_DOT.online },
  { key: 'away', label: 'Away', hint: 'Shows you as away', dot: PRESENCE_DOT.away },
  { key: 'dnd', label: 'Do not disturb', hint: 'No sounds or desktop alerts', dot: PRESENCE_DOT.dnd },
  { key: 'invisible', label: 'Invisible', hint: 'Appear offline to everyone', dot: 'bg-gray-300' },
]

function Row({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <div className="min-w-0">
        <p className="text-sm font-medium text-neutral-800">{title}</p>
        {hint && <p className="mt-0.5 text-xs text-neutral-500">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function Section({ icon, title, description, children }: { icon: React.ReactNode; title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-neutral-100 py-5 first:border-t-0 first:pt-0 last:pb-0">
      <div className="mb-2 flex items-start gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-600">{icon}</span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold leading-8 text-neutral-900">{title}</h3>
          {description && <p className="-mt-1 text-xs text-neutral-500">{description}</p>}
        </div>
      </div>
      <div className="ps-11">{children}</div>
    </section>
  )
}

function Segmented<T extends string | number>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="inline-flex flex-wrap items-center rounded-xl bg-neutral-200/60 p-1">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={`inline-flex h-7 items-center whitespace-nowrap rounded-lg px-2.5 text-xs font-semibold transition-colors ${
            value === o.value ? 'bg-white text-neutral-900 shadow-[0_1px_2px_rgba(0,0,0,0.08),0_0_0_1px_rgba(0,0,0,0.06)]' : 'text-neutral-500 hover:text-neutral-800'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export default function SettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation()
  const { orgId, token, me, setMe } = useMessaging()
  const [local, setLocal] = useState<MyStatus | null>(me)
  const [emoji, setEmoji] = useState('')
  const [text, setText] = useState('')
  const [clearAfter, setClearAfter] = useState<string>('today')
  const [saving, setSaving] = useState(false)
  const [permission, setPermission] = useState<string>('default')

  useEffect(() => {
    if (!open || !orgId || !token) return
    getMe(orgId, token).then((m) => {
      setLocal(m)
      setMe(m)
      setEmoji(m.status_emoji)
      setText(m.status_text)
    }).catch(() => {})
    setPermission(typeof Notification === 'undefined' ? 'unsupported' : Notification.permission)
  }, [open, orgId, token, setMe])

  const save = async (patch: Partial<MyStatus>) => {
    if (!orgId || !token) return
    setLocal((cur) => (cur ? { ...cur, ...patch } : cur))
    try {
      const next = await updateMe(orgId, patch, token)
      setLocal(next)
      setMe(next)
    } catch {
      // Revert to the server's view.
      getMe(orgId, token).then((m) => {
        setLocal(m)
        setMe(m)
      })
    }
  }

  const saveStatus = async (e: string, s: string, after: string) => {
    setSaving(true)
    const at = CLEAR_AFTER.find((c) => c.key === after)?.at()
    await save({ status_emoji: e, status_text: s, status_expires_at: s || e ? (at ? at.toISOString() : null) : null })
    setSaving(false)
  }

  const toggleDesktop = async (on: boolean) => {
    if (on && typeof Notification !== 'undefined' && Notification.permission === 'default') {
      const p = await Notification.requestPermission()
      setPermission(p)
      if (p !== 'granted') return
    }
    save({ desktop_notifications: on })
  }

  const modal = (content: React.ReactNode) => (
    <Modal
      isDialogOpen={open}
      onOpenChange={onOpenChange}
      size="md"
      icon={<GearSix size={16} weight="fill" />}
      dialogTitle={t('messaging.settings', { defaultValue: 'Messages settings' })}
      dialogDescription={t('messaging.settings_desc', { defaultValue: 'Your status, how you show up, and when we notify you.' })}
      dialogContent={content}
    />
  )

  if (!local) {
    return modal(
      <div className="space-y-6" aria-busy>
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex gap-3">
            <div className="h-8 w-8 animate-pulse rounded-lg bg-neutral-100" />
            <div className="flex-1 space-y-2 pt-1">
              <div className="h-3 w-1/3 animate-pulse rounded bg-neutral-100" />
              <div className="h-9 w-full animate-pulse rounded-xl bg-neutral-100/70" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  return modal(
        <div>
          <Section
            icon={<Smiley size={16} />}
            title={t('messaging.status', { defaultValue: 'Status' })}
            description={t('messaging.status_desc', { defaultValue: 'Shown next to your name in chats.' })}
          >
            <div className="mt-1 flex items-center gap-2">
              <EmojiPickerPopover onPick={setEmoji} side="bottom" align="start">
                <button
                  type="button"
                  aria-label={t('messaging.status_emoji', { defaultValue: 'Status emoji' })}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-lg ring-1 ring-inset ring-neutral-200 hover:bg-neutral-50"
                >
                  {emoji || <Smiley size={17} className="text-neutral-400" />}
                </button>
              </EmojiPickerPopover>
              <input
                value={text}
                maxLength={100}
                onChange={(e) => setText(e.target.value)}
                placeholder={t('messaging.status_placeholder', { defaultValue: "What's your status?" })}
                className={INPUT}
              />
            </div>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {PRESETS.map((p) => (
                <button
                  key={p.text}
                  type="button"
                  onClick={() => {
                    setEmoji(p.emoji)
                    setText(p.text)
                  }}
                  className={`rounded-full px-2.5 py-1 text-xs ring-1 ring-inset transition-colors ${
                    text === p.text ? 'bg-neutral-900 text-white ring-neutral-900' : 'bg-white text-neutral-700 ring-neutral-200 hover:bg-neutral-50'
                  }`}
                >
                  {p.emoji} {p.text}
                </button>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs text-neutral-500">
                {t('messaging.clear_after', { defaultValue: 'Clear after' })}
                <ToolbarSelect
                  value={clearAfter}
                  onChange={setClearAfter}
                  ariaLabel={t('messaging.clear_after', { defaultValue: 'Clear after' })}
                  options={CLEAR_AFTER.map((c) => ({ value: c.key, label: c.label }))}
                />
              </div>
              <div className="flex items-center gap-1.5">
                {(local.status_text || local.status_emoji) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setEmoji('')
                      setText('')
                      saveStatus('', '', 'never')
                    }}
                  >
                    {t('messaging.clear', { defaultValue: 'Clear' })}
                  </Button>
                )}
                <Button variant="primary" size="sm" loading={saving} onClick={() => saveStatus(emoji, text.trim(), clearAfter)}>
                  {t('messaging.save_status', { defaultValue: 'Save status' })}
                </Button>
              </div>
            </div>
          </Section>

          <Section icon={<Eye size={16} />} title={t('messaging.availability', { defaultValue: 'Availability' })}>
            <div className="mt-1 grid grid-cols-1 gap-2 sm:grid-cols-2" role="radiogroup">
              {AVAILABILITY.map((a) => (
                <button
                  key={a.key}
                  type="button"
                  role="radio"
                  aria-checked={local.availability === a.key}
                  onClick={() => save({ availability: a.key })}
                  className={`rounded-xl px-3 py-2.5 text-start transition-all ${
                    local.availability === a.key ? 'bg-white ring-2 ring-neutral-900' : 'bg-white ring-1 ring-inset ring-neutral-200 hover:ring-neutral-300'
                  }`}
                >
                  <p className="flex items-center gap-2 text-sm font-medium text-neutral-900">
                    <span className={`h-2 w-2 rounded-full ${a.dot}`} />
                    {a.label}
                  </p>
                  <p className="mt-0.5 text-[11px] text-neutral-500">{a.hint}</p>
                </button>
              ))}
            </div>
          </Section>

          <Section icon={<EnvelopeSimple size={16} />} title={t('messaging.email', { defaultValue: 'Email' })}>
            <Row
              title={t('messaging.email_unread', { defaultValue: 'Email me about unread messages' })}
              hint={t('messaging.email_unread_hint', { defaultValue: 'One summary email, never one per message.' })}
            >
              <span />
            </Row>
            <Segmented<EmailMode>
              value={local.email_mode}
              onChange={(v) => save({ email_mode: v })}
              options={[
                { value: 'all', label: 'All messages' },
                { value: 'direct', label: 'Direct & mentions' },
                { value: 'off', label: 'Off' },
              ]}
            />
            <div className={local.email_mode === 'off' ? 'opacity-40 pointer-events-none' : ''}>
              <Row title={t('messaging.email_after', { defaultValue: 'Send after a message is unread for' })}>
                <Segmented<number>
                  value={local.email_delay_minutes}
                  onChange={(v) => save({ email_delay_minutes: v as any })}
                  options={[
                    { value: 15, label: '15m' },
                    { value: 60, label: '1h' },
                    { value: 240, label: '4h' },
                    { value: 1440, label: '1d' },
                  ]}
                />
              </Row>
              <Row
                title={t('messaging.email_broadcasts', { defaultValue: 'Course announcements' })}
                hint={t('messaging.email_broadcasts_hint', { defaultValue: 'When a teacher messages your whole course' })}
              >
                <Switch checked={local.email_broadcasts} onCheckedChange={(v) => save({ email_broadcasts: v })} />
              </Row>
            </div>
          </Section>

          <Section icon={<Bell size={16} />} title={t('messaging.in_app', { defaultValue: 'In the app' })}>
            <Row
              title={t('messaging.desktop', { defaultValue: 'Desktop notifications' })}
              hint={
                permission === 'denied'
                  ? t('messaging.desktop_blocked', { defaultValue: 'Blocked in your browser settings' })
                  : permission === 'unsupported'
                    ? t('messaging.desktop_unsupported', { defaultValue: 'Not supported in this browser' })
                    : t('messaging.desktop_hint', { defaultValue: 'When this tab is in the background' })
              }
            >
              <Switch
                checked={local.desktop_notifications && permission === 'granted'}
                disabled={permission === 'denied' || permission === 'unsupported'}
                onCheckedChange={toggleDesktop}
              />
            </Row>
            <Row title={t('messaging.sounds', { defaultValue: 'Sounds' })}>
              <Switch checked={local.sounds} onCheckedChange={(v) => save({ sounds: v })} />
            </Row>
          </Section>

          <Section icon={<ShieldCheck size={16} />} title={t('messaging.privacy', { defaultValue: 'Privacy' })}>
            <Row
              title={t('messaging.read_receipts', { defaultValue: 'Read receipts' })}
              hint={t('messaging.read_receipts_hint', { defaultValue: "Let people see when you've read their messages" })}
            >
              <Switch checked={local.read_receipts} onCheckedChange={(v) => save({ read_receipts: v })} />
            </Row>
            <Row
              title={t('messaging.typing', { defaultValue: 'Typing indicator' })}
              hint={t('messaging.typing_hint', { defaultValue: "Show others when you're typing" })}
            >
              <Switch checked={local.typing_indicators} onCheckedChange={(v) => save({ typing_indicators: v })} />
            </Row>
            <Row
              title={t('messaging.allow_dms', { defaultValue: 'Direct messages from anyone' })}
              hint={t('messaging.allow_dms_hint', { defaultValue: 'Off: only admins can start a new chat with you' })}
            >
              <Switch checked={local.allow_dms} onCheckedChange={(v) => save({ allow_dms: v })} />
            </Row>
          </Section>
        </div>
  )
}
