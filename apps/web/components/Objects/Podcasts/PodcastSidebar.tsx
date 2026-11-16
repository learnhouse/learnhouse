'use client'

import React, { useState } from 'react'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import { Check, Copy, Info, Microphone, Rss, Tag } from '@phosphor-icons/react'
import { Podcast } from '@services/podcasts/podcasts'
import { getUserAvatarMediaDirectory } from '@services/media/media'
import UserAvatar from '@components/Objects/UserAvatar'
import { useAbsoluteUrl } from '@/lib/seo/useAbsoluteUrl'
import { parseTags } from '@/lib/tags'
import { formatEpisodeDate, formatLength } from '@components/Objects/Podcasts/podcastUi'

interface PodcastSidebarProps {
  podcast: Podcast
  episodeCount: number
  orgslug: string
  /** Sum of the episodes' lengths, in seconds. */
  totalSeconds?: number
}

const CARD = 'bg-white nice-shadow rounded-2xl'

function CardTitle({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <h2 className="flex items-center gap-2 text-sm font-bold text-neutral-900 mb-3">
      <span className="w-6 h-6 rounded-lg bg-neutral-100 text-neutral-500 flex items-center justify-center">{icon}</span>
      {children}
    </h2>
  )
}

/** The podcast page's side column: about, hosts, tags, details and the feed. */
export function PodcastSidebar({ podcast, episodeCount, orgslug, totalSeconds = 0 }: PodcastSidebarProps) {
  const { t, i18n } = useTranslation()
  const hosts = (podcast.authors ?? []).filter((a) => a?.authorship_status === 'ACTIVE' && a.user)
  const tags = podcast.tags ? parseTags(podcast.tags) : []
  // "About" only when it says more than the description shown in the hero.
  const about = podcast.about && podcast.about.trim() !== (podcast.description || '').trim() ? podcast.about : ''
  const updated = formatEpisodeDate(podcast.update_date, i18n.language)
  const hasFeed = podcast.public && podcast.published

  return (
    <div className="space-y-4">
      {about && (
        <section className={`${CARD} p-5`}>
          <CardTitle icon={<Info size={14} weight="bold" />}>{t('podcasts.listen.about')}</CardTitle>
          <p className="text-sm text-neutral-600 leading-relaxed whitespace-pre-line break-words text-pretty" dir="auto">
            {about}
          </p>
        </section>
      )}

      {hosts.length > 0 && (
        <section className={`${CARD} p-5`}>
          <CardTitle icon={<Microphone size={14} weight="bold" />}>{t('podcasts.hosted_by')}</CardTitle>
          <ul className="space-y-2.5">
            {hosts.map((author) => (
              <li key={author.user.user_uuid} className="flex items-center gap-2.5 min-w-0">
                <UserAvatar
                  border="border-2"
                  rounded="rounded-full"
                  avatar_url={
                    author.user.avatar_image ? getUserAvatarMediaDirectory(author.user.user_uuid, author.user.avatar_image) : ''
                  }
                  predefined_avatar={author.user.avatar_image ? undefined : 'empty'}
                  width={32}
                  showProfilePopup={true}
                  userId={author.user.id}
                />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-neutral-900 truncate">
                    {[author.user.first_name, author.user.last_name].filter(Boolean).join(' ') || author.user.username}
                  </p>
                  <p className="text-xs text-neutral-500 truncate">@{author.user.username}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className={`${CARD} p-5`}>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          <div>
            <dt className="text-xs text-neutral-500">{t('podcasts.episodes')}</dt>
            <dd className="font-semibold text-neutral-900 tabular-nums">{episodeCount}</dd>
          </div>
          {totalSeconds > 0 && (
            <div>
              <dt className="text-xs text-neutral-500">{t('podcasts.listen.total_length')}</dt>
              <dd className="font-semibold text-neutral-900 tabular-nums">{formatLength(totalSeconds, t)}</dd>
            </div>
          )}
          {updated && (
            <div>
              <dt className="text-xs text-neutral-500">{t('podcasts.listen.updated')}</dt>
              <dd className="font-semibold text-neutral-900">{updated}</dd>
            </div>
          )}
        </dl>

        {tags.length > 0 && (
          <div className="mt-4 pt-4 border-t border-neutral-100">
            <p className="flex items-center gap-1.5 text-xs text-neutral-500 mb-2">
              <Tag size={12} />
              {t('podcasts.tags')}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full px-2.5 py-1 text-xs font-medium text-neutral-600 bg-neutral-100/80 ring-1 ring-inset ring-neutral-900/5"
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>
        )}

        {hasFeed && <FeedRow orgslug={orgslug} podcastUuid={podcast.podcast_uuid} />}
      </section>
    </div>
  )
}

function FeedRow({ orgslug, podcastUuid }: { orgslug: string; podcastUuid: string }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const feedUrl = useAbsoluteUrl(orgslug, `/podcast/${podcastUuid.replace('podcast_', '')}/feed`)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(feedUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
      toast.success(t('podcasts.distribution.copied'))
    } catch {
      toast.error(t('podcasts.dashboard.list.copy_failed'))
    }
  }

  return (
    <div className="mt-4 pt-4 border-t border-neutral-100">
      <p className="flex items-center gap-1.5 text-xs text-neutral-500 mb-2">
        <Rss size={12} />
        {t('podcasts.listen.feed_hint')}
      </p>
      <div className="flex items-center gap-1.5">
        <input
          readOnly
          value={feedUrl}
          aria-label={t('podcasts.distribution.rss_title')}
          onFocus={(e) => e.currentTarget.select()}
          className="flex-1 min-w-0 h-8 px-2.5 rounded-lg bg-neutral-50 ring-1 ring-inset ring-neutral-200 text-xs text-neutral-600 font-mono truncate focus:outline-none focus:ring-neutral-300"
          dir="ltr"
        />
        <button
          type="button"
          onClick={copy}
          aria-label={t('podcasts.distribution.copy')}
          title={t('podcasts.distribution.copy')}
          className="h-8 w-8 shrink-0 rounded-lg flex items-center justify-center text-neutral-600 bg-white shadow-[0_1px_1px_rgba(0,0,0,0.03),0_0_0_1px_rgba(0,0,0,0.07)] hover:text-neutral-900 hover:bg-neutral-50 transition-colors"
        >
          {copied ? <Check size={14} weight="bold" className="text-emerald-600" /> : <Copy size={14} />}
        </button>
      </div>
    </div>
  )
}
