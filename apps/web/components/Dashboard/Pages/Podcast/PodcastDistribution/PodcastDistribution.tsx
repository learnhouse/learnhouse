'use client'
import React, { useState } from 'react'
import { usePodcast } from '@components/Contexts/PodcastContext'
import { useAbsoluteUrl } from '@/lib/seo/useAbsoluteUrl'
import { ArrowSquareOut, Check, CheckCircle, Copy, Lightbulb, Rss, Warning, Broadcast } from '@phosphor-icons/react'
import { SiApplepodcasts, SiSpotify, SiYoutubemusic, SiAudible } from '@icons-pack/react-simple-icons'
import toast from 'react-hot-toast'
import { Trans, useTranslation } from 'react-i18next'
import { Button, SectionCard, buttonClass } from '@components/Dashboard/Shared/DashKit/DashKit'
import { PodcastEditorPage } from '../podcastEditorUi'

interface PodcastDistributionProps {
  orgslug: string
  podcastuuid: string
}

const LINK = 'font-medium text-neutral-900 underline underline-offset-2 hover:text-neutral-600'

type Directory = {
  key: 'apple' | 'spotify' | 'youtube_music' | 'amazon'
  name: string
  tile: string
  icon: React.ReactNode
  url: string
  steps: number
}

const DIRECTORIES: Directory[] = [
  {
    key: 'apple',
    name: 'Apple Podcasts',
    tile: 'bg-gradient-to-br from-purple-500 to-pink-500',
    icon: <SiApplepodcasts size={18} color="#fff" />,
    url: 'https://podcastsconnect.apple.com',
    steps: 4,
  },
  {
    key: 'spotify',
    name: 'Spotify',
    tile: 'bg-[#1DB954]',
    icon: <SiSpotify size={18} color="#fff" />,
    url: 'https://podcasters.spotify.com',
    steps: 4,
  },
  {
    key: 'youtube_music',
    name: 'YouTube Music',
    tile: 'bg-red-500',
    icon: <SiYoutubemusic size={18} color="#fff" />,
    url: 'https://podcasts.google.com/publish',
    steps: 4,
  },
  {
    key: 'amazon',
    name: 'Amazon Music / Audible',
    tile: 'bg-[#00A8E1]',
    icon: <SiAudible size={18} color="#fff" />,
    url: 'https://podcasters.amazon.com',
    steps: 3,
  },
]

// Step 1 links to the directory, step 2 of Apple bolds a word; the rest are
// plain strings. Same keys as before.
function Step({ dir, n }: { dir: Directory; n: number }) {
  const { t } = useTranslation()
  const key = `podcasts.distribution.${dir.key}.step${n}`
  if (n === 1) {
    return <Trans i18nKey={key} components={{ link: <a href={dir.url} target="_blank" rel="noopener noreferrer" className={LINK} /> }} />
  }
  if (dir.key === 'apple' && n === 2) return <Trans i18nKey={key} components={{ strong: <strong /> }} />
  return <>{t(key)}</>
}

function PodcastDistribution({ orgslug, podcastuuid }: PodcastDistributionProps) {
  const { t } = useTranslation()
  const { podcast, episodes } = usePodcast()
  const [copied, setCopied] = useState(false)

  const shortUuid = podcastuuid.replace('podcast_', '')
  // Absolute: this URL is pasted into Apple Podcasts / Spotify, not clicked in-app
  const feedUrl = useAbsoluteUrl(orgslug, `/podcast/${shortUuid}/feed`)

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

  // Live checklist against the directories' basic requirements.
  const publishedEpisodes = (Array.isArray(episodes) ? episodes : []).filter((ep) => ep.published).length
  const checks = [
    { ok: !!podcast?.published, label: t('podcasts.distribution.check_published') },
    { ok: !!podcast?.thumbnail_image, label: t('podcasts.distribution.check_cover') },
    { ok: publishedEpisodes > 0, label: t('podcasts.distribution.check_episode') },
    { ok: !!podcast?.description?.trim(), label: t('podcasts.distribution.check_description') },
  ]

  return (
    <PodcastEditorPage>
      <SectionCard
        icon={<Rss size={16} />}
        title={t('podcasts.distribution.rss_title')}
        description={t('podcasts.distribution.rss_description')}
      >
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            readOnly
            value={feedUrl}
            onFocus={(e) => e.currentTarget.select()}
            aria-label={t('podcasts.distribution.rss_title')}
            className="flex-1 min-w-0 h-9 px-3 rounded-lg bg-neutral-50 ring-1 ring-inset ring-neutral-200 font-mono text-xs text-neutral-700 focus:outline-none focus:ring-2 focus:ring-neutral-900/15"
            dir="ltr"
          />
          <div className="flex gap-2 shrink-0">
            <Button variant="primary" onClick={copy} icon={copied ? <Check size={14} /> : <Copy size={14} />}>
              {t('podcasts.distribution.copy')}
            </Button>
            <a href={feedUrl} target="_blank" rel="noopener noreferrer" className={buttonClass('secondary', 'md')}>
              <ArrowSquareOut size={14} />
              {t('podcasts.distribution.preview')}
            </a>
          </div>
        </div>
        {!podcast?.published && (
          <div className="mt-3 flex items-start gap-2 rounded-xl bg-amber-50 ring-1 ring-inset ring-amber-200 px-3.5 py-2.5 text-sm text-amber-800">
            <Warning size={16} className="mt-0.5 shrink-0" />
            {t('podcasts.distribution.unpublished_warning')}
          </div>
        )}
      </SectionCard>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_380px] gap-5 items-start">
        <SectionCard
          icon={<Broadcast size={16} />}
          title={t('podcasts.distribution.directories_title')}
          description={t('podcasts.distribution.directories_description')}
        >
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {DIRECTORIES.map((dir) => (
              <div key={dir.key} className="rounded-xl ring-1 ring-inset ring-neutral-200 p-4">
                <div className="flex items-center gap-3 mb-3">
                  <span className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${dir.tile}`}>{dir.icon}</span>
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-neutral-900">{dir.name}</h3>
                    <p className="text-xs text-neutral-500">{t(`podcasts.distribution.${dir.key}.subtitle`)}</p>
                  </div>
                </div>
                <ol className="space-y-2 text-sm text-neutral-600">
                  {Array.from({ length: dir.steps }).map((_, i) => (
                    <li key={i} className="flex items-start gap-2.5">
                      <span className="mt-px w-5 h-5 shrink-0 rounded-full bg-neutral-100 text-[11px] font-semibold text-neutral-600 flex items-center justify-center tabular-nums">
                        {i + 1}
                      </span>
                      <span className="min-w-0">
                        <Step dir={dir} n={i + 1} />
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        </SectionCard>

        <div className="space-y-5">
          <SectionCard
            icon={<CheckCircle size={16} />}
            title={t('podcasts.distribution.checklist_title')}
            description={t('podcasts.distribution.checklist_description')}
          >
            <ul className="space-y-2.5">
              {checks.map((check) => (
                <li key={check.label} className="flex items-center gap-2.5 text-sm">
                  <span
                    className={`w-5 h-5 shrink-0 rounded-full flex items-center justify-center ${
                      check.ok ? 'bg-emerald-500 text-white' : 'ring-1 ring-inset ring-neutral-300 text-transparent'
                    }`}
                  >
                    <Check size={11} weight="bold" />
                  </span>
                  <span className={check.ok ? 'text-neutral-500 line-through decoration-neutral-300' : 'text-neutral-800'}>
                    {check.label}
                  </span>
                </li>
              ))}
            </ul>
          </SectionCard>

          <SectionCard
            icon={<Lightbulb size={16} />}
            title={t('podcasts.distribution.tips_title')}
            description={t('podcasts.distribution.tips_description')}
          >
            <ul className="space-y-2.5 text-sm text-neutral-600">
              {[
                <Trans key="t" i18nKey="podcasts.distribution.tip_thumbnail" components={{ strong: <strong /> }} />,
                <Trans key="e" i18nKey="podcasts.distribution.tip_episode" components={{ strong: <strong /> }} />,
                <Trans key="d" i18nKey="podcasts.distribution.tip_description" components={{ strong: <strong /> }} />,
                t('podcasts.distribution.tip_auto'),
                t('podcasts.distribution.tip_propagate'),
              ].map((tip, i) => (
                <li key={i} className="flex items-start gap-2.5">
                  <CheckCircle size={16} className="mt-0.5 shrink-0 text-emerald-500" />
                  <span>{tip}</span>
                </li>
              ))}
            </ul>
          </SectionCard>
        </div>
      </div>
    </PodcastEditorPage>
  )
}

export default PodcastDistribution
