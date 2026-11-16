'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { ArrowsClockwise, Check, Copy, Info, Key, WarningCircle } from '@phosphor-icons/react'
import { Button, FieldLabel, INPUT, Modal } from '@/design'
import { errorMessage } from '@services/ee/platform/api'
import { createChannel, opsKeys, updateChannel, CHANNEL_KINDS, type Channel, type ChannelKind } from '@services/ee/platform/ops'
import { PLATFORM_ROLES } from '@services/ee/platform/types'
import { useAccessToken } from '@components/Admin/hooks'
import { MultiPick, TONE, useTeamList } from '@components/Admin/Shared/OpsKit'
import { KIND_META, KindIcon } from './channelVisuals'
import NotionCheck from './NotionCheck'

// Create / edit a notification channel. New channels start with the big
// "choose a type" cards, then a guided setup for that kind (where to find
// the webhook URL, the Notion token…). Secrets come back masked, so on edit
// an empty secret field keeps the stored one.

const DISCORD_RE = /^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\/\d+\/[\w-]+\/?$/
const SLACK_RE = /^https:\/\/hooks\.slack\.com\/services\/\S+$/
const NOTION_TOKEN_RE = /^(secret_|ntn_)\S{10,}$/

/** A Notion database id from a pasted id or database URL (32 hex, dashes optional). */
export function notionDatabaseId(input: string): string {
  const v = input.trim()
  const m = v.replace(/-/g, '').match(/([0-9a-f]{32})(?![0-9a-f])/i)
  return m ? m[1].toLowerCase() : v
}

function randomSecret(): string {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  return 'whsec_' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

interface Draft {
  name: string
  url: string
  token: string
  database_id: string
  secret: string
  roles: string[]
  user_ids: number[]
}

function emptyDraft(): Draft {
  return { name: '', url: '', token: '', database_id: '', secret: '', roles: [], user_ids: [] }
}

function Steps({ steps }: { steps: React.ReactNode[] }) {
  return (
    <ol className="space-y-1.5 text-[13px] text-neutral-600">
      {steps.map((s, i) => (
        <li key={i} className="flex items-start gap-2.5">
          <span className="mt-px h-5 w-5 shrink-0 rounded-full bg-neutral-100 text-neutral-600 text-[11px] font-semibold tabular-nums inline-flex items-center justify-center">{i + 1}</span>
          <span className="min-w-0">{s}</span>
        </li>
      ))}
    </ol>
  )
}

export default function ChannelDialog({
  open,
  channel,
  onClose,
}: {
  open: boolean
  /** Edit this channel; null = create a new one. */
  channel: Channel | null
  onClose: () => void
}) {
  const { t } = useTranslation()
  const token = useAccessToken()
  const queryClient = useQueryClient()
  const team = useTeamList(open)
  const [kind, setKind] = React.useState<ChannelKind | null>(null)
  const [draft, setDraft] = React.useState<Draft>(emptyDraft)
  const [busy, setBusy] = React.useState(false)
  const [touched, setTouched] = React.useState(false)
  const [copied, setCopied] = React.useState(false)
  // A Notion channel that was just created stays open on its database check.
  const [created, setCreated] = React.useState<Channel | null>(null)
  const editing = !!channel

  // Reset the form whenever the dialog opens on another channel (or "new").
  const openKey = open ? channel?.channel_uuid ?? 'new' : null
  const [seenKey, setSeenKey] = React.useState<string | null>(null)
  if (openKey !== seenKey) {
    setSeenKey(openKey)
    if (openKey) {
      setTouched(false)
      setCopied(false)
      setCreated(null)
      if (channel) {
        const c = channel.config ?? {}
        setKind(channel.kind as ChannelKind)
        setDraft({
          ...emptyDraft(),
          name: channel.name,
          database_id: typeof c.database_id === 'string' ? c.database_id : '',
          roles: Array.isArray(c.roles) ? (c.roles as string[]) : [],
          user_ids: Array.isArray(c.user_ids) ? (c.user_ids as number[]) : [],
        })
      } else {
        setKind(null)
        setDraft(emptyDraft())
      }
    }
  }

  const pick = (k: ChannelKind) => {
    setKind(k)
    setDraft((d) => ({ ...d, name: d.name || t(`admin.notifications.kinds.${k}`), secret: k === 'webhook' ? randomSecret() : '' }))
  }
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }))

  // Field errors. On edit, empty secret fields mean "keep".
  const errors: Partial<Record<keyof Draft, string>> = {}
  if (!draft.name.trim()) errors.name = t('admin.notifications.channels.err_name')
  if (kind === 'discord' && (draft.url || !editing) && !DISCORD_RE.test(draft.url.trim())) errors.url = t('admin.notifications.channels.err_discord')
  if (kind === 'slack' && (draft.url || !editing) && !SLACK_RE.test(draft.url.trim())) errors.url = t('admin.notifications.channels.err_slack')
  if (kind === 'webhook' && (draft.url || !editing) && !/^https:\/\/\S+$/.test(draft.url.trim())) errors.url = t('admin.notifications.channels.err_https')
  if (kind === 'webhook' && !editing && draft.secret.length < 16) errors.secret = t('admin.notifications.channels.err_secret')
  if (kind === 'notion' && (draft.token || !editing) && !NOTION_TOKEN_RE.test(draft.token.trim())) errors.token = t('admin.notifications.channels.err_notion_token')
  if (kind === 'notion' && !/^[0-9a-f]{32}$/i.test(notionDatabaseId(draft.database_id).replace(/-/g, ''))) errors.database_id = t('admin.notifications.channels.err_database')
  if (kind === 'email' && draft.roles.length === 0 && draft.user_ids.length === 0) errors.roles = t('admin.notifications.channels.err_recipients')
  const valid = Object.keys(errors).length === 0
  const err = (k: keyof Draft) => (touched ? errors[k] : undefined)

  const buildConfig = (): Record<string, unknown> | undefined => {
    const url = draft.url.trim()
    switch (kind) {
      case 'discord':
      case 'slack':
        return url ? { url } : undefined
      case 'webhook': {
        const c: Record<string, unknown> = {}
        if (url) c.url = url
        if (draft.secret) c.secret = draft.secret
        return Object.keys(c).length ? c : undefined
      }
      case 'notion': {
        const c: Record<string, unknown> = { database_id: notionDatabaseId(draft.database_id) }
        if (draft.token.trim()) c.token = draft.token.trim()
        return c
      }
      case 'email':
        return { roles: draft.roles, user_ids: draft.user_ids }
      default:
        return undefined
    }
  }

  const save = async () => {
    setTouched(true)
    if (!valid || !kind) return
    setBusy(true)
    try {
      const config = buildConfig()
      if (editing && channel) {
        await updateChannel(token, channel.channel_uuid, { name: draft.name.trim(), ...(config ? { config } : {}) })
        toast.success(t('admin.notifications.channels.saved'))
        onClose()
      } else {
        const ch = await createChannel(token, { name: draft.name.trim(), kind, config: config ?? {}, enabled: true })
        toast.success(t('admin.notifications.channels.created'))
        if (kind === 'notion' && ch?.channel_uuid) setCreated(ch)
        else onClose()
      }
      queryClient.invalidateQueries({ queryKey: opsKeys.channels() })
    } catch (e) {
      toast.error(errorMessage(e, t('admin.common.error_desc')))
    } finally {
      setBusy(false)
    }
  }

  const copySecret = async () => {
    try {
      await navigator.clipboard.writeText(draft.secret)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      // clipboard blocked
    }
  }

  const showPicker = !editing && !kind
  const title = created
    ? t('admin.notifications.channels.notion_check_title')
    : showPicker
      ? t('admin.notifications.channels.new_title')
      : editing
        ? t('admin.notifications.channels.edit_title', { name: channel?.name ?? '' })
        : t('admin.notifications.channels.setup_title', { kind: t(`admin.notifications.kinds.${kind}`) })

  const external = (href: string, label: string) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="font-medium text-neutral-900 underline underline-offset-2">
      {label}
    </a>
  )

  const body = created ? (
    <div className="space-y-4">
      <p className="text-sm text-neutral-600">{t('admin.notifications.channels.notion_check_desc')}</p>
      <NotionCheck channelUuid={created.channel_uuid} autoRun />
    </div>
  ) : showPicker ? (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
      {CHANNEL_KINDS.map((k) => {
        const meta = KIND_META[k]
        const Icon = meta.icon
        return (
          <button
            key={k}
            type="button"
            onClick={() => pick(k)}
            className="flex flex-col items-center justify-center gap-3 h-32 rounded-xl bg-white nice-shadow hover:scale-[1.02] transition-transform px-3 text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/20"
          >
            <span className={`w-12 h-12 rounded-2xl inline-flex items-center justify-center ${TONE[meta.tone]}`}>
              <Icon size={26} weight="fill" />
            </span>
            <span className="text-sm font-semibold text-neutral-900">{t(`admin.notifications.kinds.${k}`)}</span>
            <span className="-mt-2 text-[11px] text-neutral-500 leading-snug">{t(`admin.notifications.kinds_desc.${k}`)}</span>
          </button>
        )
      })}
    </div>
  ) : (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault()
        save()
      }}
    >
      <div>
        <FieldLabel error={err('name')}>{t('admin.notifications.channels.name')}</FieldLabel>
        <input className={INPUT} value={draft.name} onChange={(e) => set({ name: e.target.value })} maxLength={120} autoFocus={!editing} />
      </div>

      {(kind === 'discord' || kind === 'slack') && (
        <>
          {!editing && (
            <Steps
              steps={
                kind === 'discord'
                  ? [
                      t('admin.notifications.channels.discord_1'),
                      t('admin.notifications.channels.discord_2'),
                      t('admin.notifications.channels.discord_3'),
                      t('admin.notifications.channels.discord_4'),
                    ]
                  : [
                      <span key="s1">
                        {t('admin.notifications.channels.slack_1_pre')} {external('https://api.slack.com/apps', 'api.slack.com/apps')}
                      </span>,
                      t('admin.notifications.channels.slack_2'),
                      t('admin.notifications.channels.slack_3'),
                    ]
              }
            />
          )}
          <div>
            <FieldLabel error={err('url')} hint={editing ? t('admin.notifications.channels.keep_hint') : undefined}>
              {t('admin.notifications.channels.webhook_url')}
            </FieldLabel>
            <input
              className={`${INPUT} font-mono text-xs`}
              dir="ltr"
              value={draft.url}
              onChange={(e) => set({ url: e.target.value })}
              placeholder={editing ? String(channel?.config?.url ?? '') : kind === 'discord' ? 'https://discord.com/api/webhooks/…' : 'https://hooks.slack.com/services/…'}
            />
          </div>
        </>
      )}

      {kind === 'notion' && (
        <>
          {!editing && (
            <Steps
              steps={[
                <span key="n1">
                  {t('admin.notifications.channels.notion_1_pre')} {external('https://www.notion.so/my-integrations', 'notion.so/my-integrations')}
                </span>,
                t('admin.notifications.channels.notion_2'),
                t('admin.notifications.channels.notion_3'),
                t('admin.notifications.channels.notion_4'),
              ]}
            />
          )}
          <div>
            <FieldLabel error={err('token')} hint={editing ? t('admin.notifications.channels.keep_hint') : undefined}>
              {t('admin.notifications.channels.notion_token')}
            </FieldLabel>
            <input
              className={`${INPUT} font-mono text-xs`}
              dir="ltr"
              type="password"
              autoComplete="off"
              value={draft.token}
              onChange={(e) => set({ token: e.target.value })}
              placeholder={editing ? String(channel?.config?.token ?? '') : 'ntn_…'}
            />
          </div>
          <div>
            <FieldLabel error={err('database_id')} hint={t('admin.notifications.channels.database_hint')}>
              {t('admin.notifications.channels.database_id')}
            </FieldLabel>
            <input
              className={`${INPUT} font-mono text-xs`}
              dir="ltr"
              value={draft.database_id}
              onChange={(e) => set({ database_id: e.target.value })}
              onBlur={() => draft.database_id && set({ database_id: notionDatabaseId(draft.database_id) })}
              placeholder="https://www.notion.so/…?v=…"
            />
          </div>
          {editing && channel && <NotionCheck channelUuid={channel.channel_uuid} />}
        </>
      )}

      {kind === 'webhook' && (
        <>
          <div>
            <FieldLabel error={err('url')} hint={editing ? t('admin.notifications.channels.keep_hint') : t('admin.notifications.channels.https_hint')}>
              {t('admin.notifications.channels.endpoint')}
            </FieldLabel>
            <input
              className={`${INPUT} font-mono text-xs`}
              dir="ltr"
              value={draft.url}
              onChange={(e) => set({ url: e.target.value })}
              placeholder={editing ? String(channel?.config?.url ?? '') : 'https://example.com/learnhouse-hook'}
            />
          </div>
          <div>
            <FieldLabel error={err('secret')}>{t('admin.notifications.channels.signing_secret')}</FieldLabel>
            {draft.secret ? (
              <>
                <div className="flex items-center gap-2">
                  <code dir="ltr" className="flex-1 min-w-0 truncate rounded-lg bg-neutral-100 px-3 h-9 inline-flex items-center font-mono text-xs text-neutral-800">
                    {draft.secret}
                  </code>
                  <Button size="md" icon={copied ? <Check size={13} weight="bold" /> : <Copy size={13} />} onClick={copySecret}>
                    {copied ? t('admin.notifications.channels.copied') : t('admin.notifications.channels.copy')}
                  </Button>
                </div>
                <p className="mt-1.5 flex items-start gap-1.5 text-xs text-amber-700">
                  <WarningCircle size={13} weight="fill" className="mt-px shrink-0" />
                  {t('admin.notifications.channels.secret_once')}
                </p>
              </>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-neutral-500 font-mono" dir="ltr">
                  {String(channel?.config?.secret ?? '••••')}
                </span>
                <Button size="sm" icon={<ArrowsClockwise size={12} />} onClick={() => set({ secret: randomSecret() })}>
                  {t('admin.notifications.channels.rotate_secret')}
                </Button>
              </div>
            )}
          </div>
          <div className="space-y-1.5 text-xs text-neutral-500">
            <p className="flex items-center gap-1.5 font-semibold text-neutral-700">
              <Key size={13} />
              {t('admin.notifications.channels.verify_title')}
            </p>
            <p>{t('admin.notifications.channels.verify_desc')}</p>
            <code dir="ltr" className="block rounded-lg bg-neutral-100 px-3 py-2 font-mono text-[11px] text-neutral-700 break-all">
              X-LearnHouse-Signature: sha256=&lt;hmac&gt;
            </code>
          </div>
        </>
      )}

      {kind === 'email' && (
        <>
          <p className="flex items-start gap-2 text-[13px] text-neutral-600">
            <Info size={15} className="mt-px shrink-0 text-sky-600" />
            {t('admin.notifications.channels.email_desc')}
          </p>
          <div>
            <FieldLabel error={err('roles')}>{t('admin.notifications.channels.roles')}</FieldLabel>
            <MultiPick
              className="w-full"
              label={t('admin.notifications.channels.roles')}
              emptyLabel={t('admin.notifications.channels.no_roles')}
              options={PLATFORM_ROLES.map((r) => ({ value: r, label: t(`admin.roles.${r}`) }))}
              value={draft.roles}
              onChange={(roles) => set({ roles })}
            />
          </div>
          <div>
            <FieldLabel>{t('admin.notifications.channels.people')}</FieldLabel>
            <MultiPick
              className="w-full"
              label={t('admin.notifications.channels.people')}
              emptyLabel={team.isLoading ? t('common.loading') : t('admin.notifications.channels.no_people')}
              options={team.members.map((m) => ({ value: String(m.user_id), label: m.username }))}
              value={draft.user_ids.map(String)}
              onChange={(ids) => set({ user_ids: ids.map(Number) })}
            />
          </div>
        </>
      )}
      <button type="submit" hidden />
    </form>
  )

  return (
    <Modal
      isDialogOpen={open}
      onOpenChange={(o) => !o && onClose()}
      preventClose={busy}
      size={showPicker ? 'lg' : 'md'}
      icon={kind ? <KindIcon kind={kind} size="sm" /> : undefined}
      onBack={!editing && kind && !created ? () => setKind(null) : undefined}
      dialogTitle={title}
      dialogDescription={showPicker ? t('admin.notifications.channels.new_desc') : undefined}
      dialogContent={body}
      footer={
        created ? (
          <Button variant="primary" onClick={onClose}>
            {t('admin.notifications.channels.done')}
          </Button>
        ) : showPicker ? (
          <Button onClick={onClose}>{t('common.cancel')}</Button>
        ) : (
          <>
            <Button onClick={onClose} disabled={busy}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" onClick={save} loading={busy} disabled={touched && !valid}>
              {editing ? t('common.save') : t('admin.notifications.channels.create')}
            </Button>
          </>
        )
      }
    />
  )
}
