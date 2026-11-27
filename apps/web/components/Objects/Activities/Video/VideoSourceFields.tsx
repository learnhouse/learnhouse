'use client'

/*
 Form pieces for setting up a video: which service a link is from (with a
 preview), and a start/end trim typed as clock times. Shared by the create
 and edit activity modals.
*/
import React, { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link as LinkIcon, Play, UploadSimple } from '@phosphor-icons/react'
import { INPUT } from '@components/Dashboard/Shared/DashKit/DashKit'
import { cn } from '@/lib/utils'
import { detectVideoLink, videoServiceNames, type VideoLinkMatch } from './providers/registry'
import { formatClock, parseClock, youTubeThumbnailUrl } from './videoSource'

// One restrained tint per service; unknown services read as neutral.
const SOURCE_TONES: Record<string, string> = {
  youtube: 'bg-rose-50 text-rose-700 ring-rose-600/15',
  vimeo: 'bg-sky-50 text-sky-700 ring-sky-600/15',
  loom: 'bg-violet-50 text-violet-700 ring-violet-600/15',
  upload: 'bg-neutral-100 text-neutral-700 ring-neutral-900/10',
}

/** "YouTube", "Vimeo", "Upload"… as a small coloured pill. */
export function VideoSourceBadge({ provider, label, className }: { provider: string; label: string; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset',
        SOURCE_TONES[provider] || SOURCE_TONES.upload,
        className,
      )}
    >
      {provider === 'upload' ? <UploadSimple size={11} weight="bold" /> : <Play size={10} weight="fill" />}
      {label}
    </span>
  )
}

/** Names of every service a link can come from, for hints. */
export function useVideoServiceNames(): string {
  return useMemo(() => videoServiceNames(), [])
}

function LinkPreview({ match }: { match: VideoLinkMatch }) {
  if (match.provider === 'youtube') {
    return (
      <img
        src={youTubeThumbnailUrl(match.videoId, 'hq')}
        alt=""
        loading="lazy"
        className="absolute inset-0 h-full w-full object-cover"
      />
    )
  }
  return (
    <iframe
      src={match.embedUrl}
      title={match.label}
      loading="lazy"
      allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
      className="absolute inset-0 h-full w-full border-0"
    />
  )
}

/**
 * A link input that says which service the video is from and shows it. Calls
 * `onMatch` with the recognised video (or null) as the author types.
 */
export function VideoLinkField({
  value,
  onChange,
  onMatch,
  id,
  autoFocus,
}: {
  value: string
  onChange: (_value: string) => void
  onMatch?: (_match: VideoLinkMatch | null) => void
  id?: string
  autoFocus?: boolean
}) {
  const { t } = useTranslation()
  const services = useVideoServiceNames()
  const match = useMemo(() => (value.trim() ? detectVideoLink(value) : null), [value])
  useEffect(() => {
    onMatch?.(match)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match?.provider, match?.videoId])

  return (
    <div className="space-y-2">
      <div className="relative">
        <LinkIcon size={14} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-neutral-400" />
        <input
          id={id}
          autoFocus={autoFocus}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          type="url"
          inputMode="url"
          dir="ltr"
          required
          aria-label={t('activities.modal.video_link', 'Video link')}
          aria-invalid={!!value.trim() && !match}
          placeholder="https://"
          className={cn(INPUT, 'ps-9')}
        />
      </div>
      {match ? (
        <div className="flex items-start gap-3 rounded-xl bg-neutral-50/80 p-2 ring-1 ring-inset ring-neutral-900/[0.05]">
          <div className="relative aspect-video w-32 shrink-0 overflow-hidden rounded-lg bg-neutral-900">
            <LinkPreview match={match} />
          </div>
          <div className="min-w-0 space-y-1 pt-0.5">
            <VideoSourceBadge provider={match.provider} label={match.label} />
            <p className="text-xs text-neutral-500">
              {t('activities.modal.video_link_detected', 'Plays in the lesson with its own player.')}
            </p>
          </div>
        </div>
      ) : (
        <p className={cn('text-xs', value.trim() ? 'text-rose-600' : 'text-neutral-400')} role={value.trim() ? 'alert' : undefined}>
          {value.trim()
            ? t('activities.modal.video_link_unsupported', 'That link isn’t from a video service we can play. Try {{services}}.', { services })
            : t('activities.modal.video_link_hint', 'Paste a link from {{services}}.', { services })}
        </p>
      )}
    </div>
  )
}

function ClockInput({
  seconds,
  onCommit,
  label,
  invalid,
}: {
  seconds: number | null
  onCommit: (_seconds: number | null) => void
  label: string
  invalid?: boolean
}) {
  const [text, setText] = useState(seconds ? formatClock(seconds) : '')
  // Follow the stored value when it changes from outside (React's
  // "adjust state on prop change" pattern, no effect).
  const [shown, setShown] = useState(seconds)
  if (shown !== seconds) {
    setShown(seconds)
    setText(seconds ? formatClock(seconds) : '')
  }
  const parsed = text.trim() ? parseClock(text) : null
  const bad = invalid || (parsed != null && Number.isNaN(parsed))
  const commit = () => {
    if (!text.trim()) return onCommit(null)
    if (parsed != null && !Number.isNaN(parsed)) onCommit(parsed || null)
  }
  return (
    <input
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          commit()
        }
      }}
      inputMode="numeric"
      dir="ltr"
      placeholder="0:00"
      aria-label={label}
      aria-invalid={bad}
      className={cn(INPUT, 'w-24 text-center tabular-nums', bad && 'ring-rose-400 text-rose-700')}
    />
  )
}

/**
 * Start and end of the part of the video learners watch, typed as `1:30` or
 * `1:02:03`. An end at or before the start is refused, as before.
 */
export function VideoTrimFields({
  start,
  end,
  onChange,
}: {
  start: number
  end: number | null
  onChange: (_next: { startTime: number; endTime: number | null }) => void
}) {
  const { t } = useTranslation()
  const [endError, setEndError] = useState(false)
  const length = end && end > start ? end - start : null
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1">
          <span className="block text-xs font-medium text-neutral-500">{t('activities.modal.start_time')}</span>
          <ClockInput
            seconds={start || null}
            label={t('activities.modal.start_time')}
            onCommit={(s) => {
              const next = s || 0
              setEndError(!!end && end <= next)
              onChange({ startTime: next, endTime: end && end > next ? end : null })
            }}
          />
        </label>
        <span aria-hidden="true" className="pb-2.5 text-neutral-300">→</span>
        <label className="space-y-1">
          <span className="block text-xs font-medium text-neutral-500">{t('activities.modal.end_time_optional')}</span>
          <ClockInput
            seconds={end}
            invalid={endError}
            label={t('activities.modal.end_time_optional')}
            onCommit={(s) => {
              if (s != null && s <= start) {
                setEndError(true)
                return
              }
              setEndError(false)
              onChange({ startTime: start, endTime: s })
            }}
          />
        </label>
        {length != null && (
          <span className="pb-2.5 text-xs tabular-nums text-neutral-500">
            {t('activities.modal.trim_length', 'Plays {{length}}', { length: formatClock(length) })}
          </span>
        )}
      </div>
      <p className={cn('text-[11px]', endError ? 'text-rose-600' : 'text-neutral-400')} role={endError ? 'alert' : undefined}>
        {endError
          ? t('activities.modal.trim_end_before_start', 'The end has to come after the start.')
          : t('activities.modal.trim_hint', 'For example 1:30. Leave the end empty to play to the end.')}
      </p>
    </div>
  )
}
