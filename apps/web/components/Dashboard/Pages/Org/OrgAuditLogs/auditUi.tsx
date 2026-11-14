'use client'
import React from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { getUserAvatarMediaDirectory } from '@services/media/media'
import { KEY_PREFIX, TARGET_TYPES, UI_STRINGS, actorName, describeEntry, initials, type AuditEntry } from './auditFormat'

/**
 * `text('filters.actor')` → t('dashboard.audit.filters.actor') with its
 * English default from UI_STRINGS (the keys are listed for translators in
 * auditFormat.ts).
 */
export function useAuditText() {
  const { t } = useTranslation()
  return React.useCallback(
    (key: string, fallback?: string, values?: Record<string, unknown>) =>
      t(KEY_PREFIX + key, { defaultValue: UI_STRINGS[key] ?? fallback ?? key, ...(values || {}) }) as string,
    [t]
  )
}

function avatarSrc(entry: AuditEntry): string | null {
  const url = entry.avatar_url
  if (!url) return null
  if (/^https?:\/\//.test(url)) return url
  return entry.user_uuid ? getUserAvatarMediaDirectory(entry.user_uuid, url) : null
}

/** The actor's avatar, without a request per row: the list already carries
 * the picture, else initials. */
export function ActorAvatar({ entry, name, size = 28 }: { entry: AuditEntry; name: string; size?: number }) {
  const [failed, setFailed] = React.useState(false)
  const src = failed ? null : avatarSrc(entry)
  const style = { width: size, height: size }
  if (src) {
    return <img src={src} alt="" style={style} onError={() => setFailed(true)} className="rounded-full object-cover shrink-0 ring-1 ring-black/5" />
  }
  return (
    <span
      style={{ ...style, fontSize: Math.max(10, Math.round(size * 0.38)) }}
      aria-hidden
      className={`rounded-full shrink-0 inline-flex items-center justify-center font-semibold ${
        entry.user_id ? 'bg-neutral-200 text-neutral-600' : 'bg-neutral-100 text-neutral-400'
      }`}
    >
      {entry.user_id ? initials(name) : '•'}
    </span>
  )
}

/** The human sentence of an entry, actor and target in bold. */
export function AuditSentence({ entry }: { entry: AuditEntry }) {
  const { t } = useTranslation()
  const text = useAuditText()
  const sentence = describeEntry(entry, {
    actor: actorName(entry, { system: text('actor.system'), unknown: text('actor.unknown'), scim: text('actor.scim'), support: text('actor.support') }),
    system: text('actor.system'),
    unknown: text('actor.unknown'),
    target: text('target.fallback'),
    type: (type) => targetTypeLabel(t, type),
  })
  return (
    <Trans
      i18nKey={sentence.key}
      defaults={sentence.defaults}
      values={sentence.values}
      components={{ b: <strong className="font-semibold text-neutral-900" /> }}
      shouldUnescape
    />
  )
}

/** "usergroup" → "group", through `dashboard.audit.types.*`. */
export function targetTypeLabel(t: (_key: string, _options?: Record<string, unknown>) => string, type: string): string {
  return t(`${KEY_PREFIX}types.${type}`, { defaultValue: TARGET_TYPES[type] ?? type.replace(/_/g, ' ') })
}
