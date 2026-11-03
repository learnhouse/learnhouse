'use client'

import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import dayjs from 'dayjs'
import { Bell, EnvelopeSimple, Eye, Smiley, SpinnerGap } from '@phosphor-icons/react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@components/ui/dialog'
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
        <p className="text-sm font-medium text-gray-800">{title}</p>
        {hint && <p className="text-xs text-gray-500 mt-0.5">{hint}</p>}
      </div>
      <div className="flex-shrink-0">{children}</div>
    </div>
  )
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section className="py-4 border-t border-gray-100 first:border-t-0 first:pt-0">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900 mb-1 [&>svg]:text-gray-400">
        {icon}
        {title}
      </h3>
      {children}
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
    <div className="inline-flex rounded-lg bg-gray-100 p-0.5">
      {options.map((o) => (
        <button
          key={String(o.value)}
          onClick={() => onChange(o.value)}
          className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
            value === o.value ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-800'
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

  if (!local) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg p-10 flex justify-center">
          <DialogTitle className="sr-only">Settings</DialogTitle>
          <SpinnerGap className="animate-spin text-gray-400" />
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg p-0 overflow-hidden" onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHeader className="px-5 py-4 border-b border-gray-100 space-y-0">
          <DialogTitle className="text-xl font-semibold text-gray-900">
            {t('messaging.settings', { defaultValue: 'Messages settings' })}
          </DialogTitle>
          <DialogDescription className="text-sm text-gray-500">
            {t('messaging.settings_desc', { defaultValue: 'Your status, how you show up, and when we notify you.' })}
          </DialogDescription>
        </DialogHeader>

        <div className="px-5 pt-4 pb-5 max-h-[70vh] overflow-y-auto">
          <Section icon={<Smiley size={15} />} title={t('messaging.status', { defaultValue: 'Status' })}>
            <div className="flex items-center gap-2 mt-2">
              <EmojiPickerPopover onPick={setEmoji} side="bottom" align="start">
                <button className="h-10 w-10 rounded-lg border border-gray-200 text-lg flex items-center justify-center hover:bg-gray-50">
                  {emoji || <Smiley size={18} className="text-gray-400" />}
                </button>
              </EmojiPickerPopover>
              <input
                value={text}
                maxLength={100}
                onChange={(e) => setText(e.target.value)}
                placeholder={t('messaging.status_placeholder', { defaultValue: "What's your status?" })}
                className="flex-1 h-10 rounded-lg border border-gray-200 px-3 text-sm outline-none focus:ring-2 focus:ring-gray-200"
              />
            </div>
            <div className="flex flex-wrap gap-1.5 mt-2.5">
              {PRESETS.map((p) => (
                <button
                  key={p.text}
                  onClick={() => {
                    setEmoji(p.emoji)
                    setText(p.text)
                  }}
                  className="rounded-md border border-gray-200 px-2.5 py-1 text-xs hover:bg-gray-50"
                >
                  {p.emoji} {p.text}
                </button>
              ))}
            </div>
            <div className="flex items-center justify-between gap-2 mt-3">
              <label className="flex items-center gap-2 text-xs text-gray-500">
                {t('messaging.clear_after', { defaultValue: 'Clear after' })}
                <select
                  value={clearAfter}
                  onChange={(e) => setClearAfter(e.target.value)}
                  className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs"
                >
                  {CLEAR_AFTER.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex items-center gap-2">
                {(local.status_text || local.status_emoji) && (
                  <button
                    onClick={() => {
                      setEmoji('')
                      setText('')
                      saveStatus('', '', 'never')
                    }}
                    className="text-xs text-gray-500 hover:text-gray-800 px-2 py-1"
                  >
                    {t('messaging.clear', { defaultValue: 'Clear' })}
                  </button>
                )}
                <button
                  onClick={() => saveStatus(emoji, text.trim(), clearAfter)}
                  disabled={saving}
                  className="rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-50"
                >
                  {t('messaging.save_status', { defaultValue: 'Save status' })}
                </button>
              </div>
            </div>
          </Section>

          <Section icon={<Eye size={15} />} title={t('messaging.availability', { defaultValue: 'Availability' })}>
            <div className="grid grid-cols-2 gap-2 mt-2">
              {AVAILABILITY.map((a) => (
                <button
                  key={a.key}
                  onClick={() => save({ availability: a.key })}
                  className={`text-start rounded-lg border px-3 py-2.5 transition-colors ${
                    local.availability === a.key ? 'border-gray-900 bg-gray-50' : 'border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  <p className="text-sm font-medium flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${a.dot}`} />
                    {a.label}
                  </p>
                  <p className="text-[11px] text-gray-500 mt-0.5">{a.hint}</p>
                </button>
              ))}
            </div>
          </Section>

          <Section icon={<EnvelopeSimple size={15} />} title={t('messaging.email', { defaultValue: 'Email' })}>
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

          <Section icon={<Bell size={15} />} title={t('messaging.in_app', { defaultValue: 'In the app' })}>
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

          <Section icon={<Eye size={15} />} title={t('messaging.privacy', { defaultValue: 'Privacy' })}>
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
      </DialogContent>
    </Dialog>
  )
}
