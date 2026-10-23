'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { usePodcast } from '@components/Contexts/PodcastContext'
import { useAbsoluteUrl } from '@/lib/seo/useAbsoluteUrl'
import { Copy, ExternalLink, Rss } from 'lucide-react'
import { SiApplepodcasts, SiSpotify, SiYoutubemusic, SiAudible } from '@icons-pack/react-simple-icons'
import { Button } from '@components/ui/button'
import { Input } from '@components/ui/input'
import toast from 'react-hot-toast'

interface PodcastDistributionProps {
  orgslug: string
  podcastuuid: string
}

function PodcastDistribution({ orgslug, podcastuuid }: PodcastDistributionProps) {
  const { t } = useTranslation()
  const { podcast } = usePodcast()

  const shortUuid = podcastuuid.replace('podcast_', '')
  // Absolute: this URL is pasted into Apple Podcasts / Spotify, not clicked in-app
  const feedUrl = useAbsoluteUrl(orgslug, `/podcast/${shortUuid}/feed`)

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
    toast.success(t('dash.podcast.copied_to_clipboard'))
  }

  return (
    <div className="sm:mx-10 mx-4 my-6 space-y-6">
      {/* RSS Feed URL */}
      <div className="bg-white rounded-xl nice-shadow p-6">
        <div className="flex items-center space-x-2 mb-4">
          <Rss size={20} className="text-orange-500" />
          <h2 className="font-bold text-xl text-gray-800">{t('dash.podcast.rss_feed')}</h2>
        </div>
        <p className="text-gray-500 text-sm mb-4">
          {t('dash.podcast.rss_feed_description')}
        </p>
        <div className="flex items-center space-x-2">
          <Input
            readOnly
            value={feedUrl}
            className="font-mono text-sm bg-gray-50"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => copyToClipboard(feedUrl)}
          >
            <Copy size={14} className="me-1" />
            {t('dash.podcast.copy')}
          </Button>
          <a href={feedUrl} target="_blank" rel="noopener noreferrer">
            <Button variant="outline" size="sm">
              <ExternalLink size={14} className="me-1" />
              {t('dash.podcast.preview')}
            </Button>
          </a>
        </div>
        {!podcast?.published && (
          <div className="mt-3 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
            <p className="text-sm text-yellow-800">
              {t('dash.podcast.unpublished_warning')}
            </p>
          </div>
        )}
      </div>

      {/* Distribution Guide */}
      <div className="bg-white rounded-xl nice-shadow p-6">
        <h2 className="font-bold text-xl text-gray-800 mb-4">{t('dash.podcast.submit_to_directories')}</h2>
        <p className="text-gray-500 text-sm mb-6">
          {t('dash.podcast.submit_description')}
        </p>

        <div className="space-y-6">
          {/* Apple Podcasts */}
          <div className="border rounded-lg p-5">
            <div className="flex items-center space-x-3 mb-3">
              <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-pink-500 rounded-xl flex items-center justify-center">
                <SiApplepodcasts size={22} color="#fff" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900">Apple Podcasts</h3>
                <p className="text-xs text-gray-400">{t('dash.podcast.apple_tagline')}</p>
              </div>
            </div>
            <ol className="text-sm text-gray-600 space-y-2 ms-1">
              <li className="flex items-start space-x-2">
                <span className="font-semibold text-gray-800 shrink-0">1.</span>
                <span>{t('dash.podcast.apple_step1_pre')} <a href="https://podcastsconnect.apple.com" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">podcastsconnect.apple.com</a> {t('dash.podcast.apple_step1_post')}</span>
              </li>
              <li className="flex items-start space-x-2">
                <span className="font-semibold text-gray-800 shrink-0">2.</span>
                <span>{t('dash.podcast.apple_step2')}</span>
              </li>
              <li className="flex items-start space-x-2">
                <span className="font-semibold text-gray-800 shrink-0">3.</span>
                <span>{t('dash.podcast.apple_step3')}</span>
              </li>
              <li className="flex items-start space-x-2">
                <span className="font-semibold text-gray-800 shrink-0">4.</span>
                <span>{t('dash.podcast.apple_step4')}</span>
              </li>
            </ol>
          </div>

          {/* Spotify */}
          <div className="border rounded-lg p-5">
            <div className="flex items-center space-x-3 mb-3">
              <div className="w-10 h-10 bg-[#1DB954] rounded-xl flex items-center justify-center">
                <SiSpotify size={22} color="#fff" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900">Spotify</h3>
                <p className="text-xs text-gray-400">{t('dash.podcast.spotify_tagline')}</p>
              </div>
            </div>
            <ol className="text-sm text-gray-600 space-y-2 ms-1">
              <li className="flex items-start space-x-2">
                <span className="font-semibold text-gray-800 shrink-0">1.</span>
                <span>{t('dash.podcast.spotify_step1_pre')} <a href="https://podcasters.spotify.com" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">podcasters.spotify.com</a> {t('dash.podcast.spotify_step1_post')}</span>
              </li>
              <li className="flex items-start space-x-2">
                <span className="font-semibold text-gray-800 shrink-0">2.</span>
                <span>{t('dash.podcast.spotify_step2')}</span>
              </li>
              <li className="flex items-start space-x-2">
                <span className="font-semibold text-gray-800 shrink-0">3.</span>
                <span>{t('dash.podcast.spotify_step3')}</span>
              </li>
              <li className="flex items-start space-x-2">
                <span className="font-semibold text-gray-800 shrink-0">4.</span>
                <span>{t('dash.podcast.spotify_step4')}</span>
              </li>
            </ol>
          </div>

          {/* Google Podcasts / YouTube Music */}
          <div className="border rounded-lg p-5">
            <div className="flex items-center space-x-3 mb-3">
              <div className="w-10 h-10 bg-red-500 rounded-xl flex items-center justify-center">
                <SiYoutubemusic size={22} color="#fff" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900">YouTube Music</h3>
                <p className="text-xs text-gray-400">{t('dash.podcast.youtube_tagline')}</p>
              </div>
            </div>
            <ol className="text-sm text-gray-600 space-y-2 ms-1">
              <li className="flex items-start space-x-2">
                <span className="font-semibold text-gray-800 shrink-0">1.</span>
                <span>{t('dash.podcast.youtube_step1_pre')} <a href="https://podcasts.google.com/publish" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">podcasts.google.com/publish</a></span>
              </li>
              <li className="flex items-start space-x-2">
                <span className="font-semibold text-gray-800 shrink-0">2.</span>
                <span>{t('dash.podcast.youtube_step2')}</span>
              </li>
              <li className="flex items-start space-x-2">
                <span className="font-semibold text-gray-800 shrink-0">3.</span>
                <span>{t('dash.podcast.youtube_step3')}</span>
              </li>
              <li className="flex items-start space-x-2">
                <span className="font-semibold text-gray-800 shrink-0">4.</span>
                <span>{t('dash.podcast.youtube_step4')}</span>
              </li>
            </ol>
          </div>

          {/* Amazon Music */}
          <div className="border rounded-lg p-5">
            <div className="flex items-center space-x-3 mb-3">
              <div className="w-10 h-10 bg-[#00A8E1] rounded-xl flex items-center justify-center">
                <SiAudible size={22} color="#fff" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900">Amazon Music / Audible</h3>
                <p className="text-xs text-gray-400">{t('dash.podcast.amazon_tagline')}</p>
              </div>
            </div>
            <ol className="text-sm text-gray-600 space-y-2 ms-1">
              <li className="flex items-start space-x-2">
                <span className="font-semibold text-gray-800 shrink-0">1.</span>
                <span>{t('dash.podcast.amazon_step1_pre')} <a href="https://podcasters.amazon.com" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">podcasters.amazon.com</a> {t('dash.podcast.amazon_step1_post')}</span>
              </li>
              <li className="flex items-start space-x-2">
                <span className="font-semibold text-gray-800 shrink-0">2.</span>
                <span>{t('dash.podcast.amazon_step2')}</span>
              </li>
              <li className="flex items-start space-x-2">
                <span className="font-semibold text-gray-800 shrink-0">3.</span>
                <span>{t('dash.podcast.amazon_step3')}</span>
              </li>
            </ol>
          </div>
        </div>
      </div>

      {/* Tips */}
      <div className="bg-white rounded-xl nice-shadow p-6">
        <h2 className="font-bold text-xl text-gray-800 mb-3">{t('dash.podcast.tips_title')}</h2>
        <ul className="text-sm text-gray-600 space-y-2">
          <li className="flex items-start space-x-2">
            <span className="text-green-500 shrink-0 mt-0.5">&#10003;</span>
            <span>{t('dash.podcast.tip_thumbnail')}</span>
          </li>
          <li className="flex items-start space-x-2">
            <span className="text-green-500 shrink-0 mt-0.5">&#10003;</span>
            <span>{t('dash.podcast.tip_published_episode')}</span>
          </li>
          <li className="flex items-start space-x-2">
            <span className="text-green-500 shrink-0 mt-0.5">&#10003;</span>
            <span>{t('dash.podcast.tip_description')}</span>
          </li>
          <li className="flex items-start space-x-2">
            <span className="text-green-500 shrink-0 mt-0.5">&#10003;</span>
            <span>{t('dash.podcast.tip_auto_appear')}</span>
          </li>
          <li className="flex items-start space-x-2">
            <span className="text-green-500 shrink-0 mt-0.5">&#10003;</span>
            <span>{t('dash.podcast.tip_propagate')}</span>
          </li>
        </ul>
      </div>
    </div>
  )
}

export default PodcastDistribution
