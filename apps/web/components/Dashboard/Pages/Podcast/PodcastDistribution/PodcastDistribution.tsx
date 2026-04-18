'use client'
import React from 'react'
import { usePodcast } from '@components/Contexts/PodcastContext'
import { useOrg } from '@components/Contexts/OrgContext'
import { getCanonicalUrl } from '@/lib/seo/utils'
import { Copy, ExternalLink, Rss } from 'lucide-react'
import { SiApplepodcasts, SiSpotify, SiYoutubemusic, SiAudible } from '@icons-pack/react-simple-icons'
import { Button } from '@components/ui/button'
import { Input } from '@components/ui/input'
import { Label } from '@components/ui/label'
import toast from 'react-hot-toast'

interface PodcastDistributionProps {
  orgslug: string
  podcastuuid: string
}

function PodcastDistribution({ orgslug, podcastuuid }: PodcastDistributionProps) {
  const { podcast } = usePodcast()
  const org = useOrg() as any

  const shortUuid = podcastuuid.replace('podcast_', '')
  const feedUrl = getCanonicalUrl(orgslug, `/podcast/${shortUuid}/feed`)

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
    toast.success('Copied to clipboard')
  }

  return (
    <div className="sm:mx-10 mx-4 my-6 space-y-6">
      {/* RSS Feed URL */}
      <div className="bg-white rounded-xl nice-shadow p-6">
        <div className="flex items-center space-x-2 mb-4">
          <Rss size={20} className="text-orange-500" />
          <h2 className="font-bold text-xl text-gray-800">RSS Feed</h2>
        </div>
        <p className="text-gray-500 text-sm mb-4">
          Your podcast RSS feed is automatically generated. Use this URL to submit your podcast to directories.
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
            Copy
          </Button>
          <a href={feedUrl} target="_blank" rel="noopener noreferrer">
            <Button variant="outline" size="sm">
              <ExternalLink size={14} className="me-1" />
              Preview
            </Button>
          </a>
        </div>
        {!podcast?.published && (
          <div className="mt-3 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
            <p className="text-sm text-yellow-800">
              Your podcast is currently unpublished. Publish it first before submitting to directories.
            </p>
          </div>
        )}
      </div>

      {/* Distribution Guide */}
      <div className="bg-white rounded-xl nice-shadow p-6">
        <h2 className="font-bold text-xl text-gray-800 mb-4">Submit to Podcast Directories</h2>
        <p className="text-gray-500 text-sm mb-6">
          Follow these steps to get your podcast listed on major platforms. Each platform requires you to submit your RSS feed URL.
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
                <p className="text-xs text-gray-400">Also distributes to Apple Music</p>
              </div>
            </div>
            <ol className="text-sm text-gray-600 space-y-2 ms-1">
              <li className="flex items-start space-x-2">
                <span className="font-semibold text-gray-800 shrink-0">1.</span>
                <span>Go to <a href="https://podcastsconnect.apple.com" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">podcastsconnect.apple.com</a> and sign in with your Apple ID</span>
              </li>
              <li className="flex items-start space-x-2">
                <span className="font-semibold text-gray-800 shrink-0">2.</span>
                <span>Click the <strong>+</strong> button and select &quot;New Show&quot;</span>
              </li>
              <li className="flex items-start space-x-2">
                <span className="font-semibold text-gray-800 shrink-0">3.</span>
                <span>Select &quot;Add a show with an RSS feed&quot; and paste your RSS feed URL</span>
              </li>
              <li className="flex items-start space-x-2">
                <span className="font-semibold text-gray-800 shrink-0">4.</span>
                <span>Apple will validate your feed — review typically takes 1-5 business days</span>
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
                <p className="text-xs text-gray-400">Largest podcast listening platform</p>
              </div>
            </div>
            <ol className="text-sm text-gray-600 space-y-2 ms-1">
              <li className="flex items-start space-x-2">
                <span className="font-semibold text-gray-800 shrink-0">1.</span>
                <span>Go to <a href="https://podcasters.spotify.com" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">podcasters.spotify.com</a> and sign in or create an account</span>
              </li>
              <li className="flex items-start space-x-2">
                <span className="font-semibold text-gray-800 shrink-0">2.</span>
                <span>Click &quot;Get started&quot; then select &quot;I have a podcast with a hosting provider&quot;</span>
              </li>
              <li className="flex items-start space-x-2">
                <span className="font-semibold text-gray-800 shrink-0">3.</span>
                <span>Paste your RSS feed URL and click &quot;Next&quot;</span>
              </li>
              <li className="flex items-start space-x-2">
                <span className="font-semibold text-gray-800 shrink-0">4.</span>
                <span>Verify ownership, fill in details, and submit — usually live within hours</span>
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
                <p className="text-xs text-gray-400">Google Podcasts migrated to YouTube Music</p>
              </div>
            </div>
            <ol className="text-sm text-gray-600 space-y-2 ms-1">
              <li className="flex items-start space-x-2">
                <span className="font-semibold text-gray-800 shrink-0">1.</span>
                <span>Go to <a href="https://podcasts.google.com/publish" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">podcasts.google.com/publish</a></span>
              </li>
              <li className="flex items-start space-x-2">
                <span className="font-semibold text-gray-800 shrink-0">2.</span>
                <span>Sign in with your Google account and click &quot;Add a podcast&quot;</span>
              </li>
              <li className="flex items-start space-x-2">
                <span className="font-semibold text-gray-800 shrink-0">3.</span>
                <span>Paste your RSS feed URL and verify ownership via email</span>
              </li>
              <li className="flex items-start space-x-2">
                <span className="font-semibold text-gray-800 shrink-0">4.</span>
                <span>Your podcast will appear on YouTube Music and Google search results</span>
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
                <p className="text-xs text-gray-400">Also available on Alexa devices</p>
              </div>
            </div>
            <ol className="text-sm text-gray-600 space-y-2 ms-1">
              <li className="flex items-start space-x-2">
                <span className="font-semibold text-gray-800 shrink-0">1.</span>
                <span>Go to <a href="https://podcasters.amazon.com" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">podcasters.amazon.com</a> and sign in with your Amazon account</span>
              </li>
              <li className="flex items-start space-x-2">
                <span className="font-semibold text-gray-800 shrink-0">2.</span>
                <span>Click &quot;Add your podcast&quot; and paste your RSS feed URL</span>
              </li>
              <li className="flex items-start space-x-2">
                <span className="font-semibold text-gray-800 shrink-0">3.</span>
                <span>Review your podcast details and submit for review</span>
              </li>
            </ol>
          </div>
        </div>
      </div>

      {/* Tips */}
      <div className="bg-white rounded-xl nice-shadow p-6">
        <h2 className="font-bold text-xl text-gray-800 mb-3">Tips for Successful Distribution</h2>
        <ul className="text-sm text-gray-600 space-y-2">
          <li className="flex items-start space-x-2">
            <span className="text-green-500 shrink-0 mt-0.5">&#10003;</span>
            <span>Make sure your podcast has a <strong>thumbnail image</strong> (1400x1400 minimum for Apple Podcasts)</span>
          </li>
          <li className="flex items-start space-x-2">
            <span className="text-green-500 shrink-0 mt-0.5">&#10003;</span>
            <span>Have at least <strong>one published episode</strong> before submitting</span>
          </li>
          <li className="flex items-start space-x-2">
            <span className="text-green-500 shrink-0 mt-0.5">&#10003;</span>
            <span>Fill in a descriptive <strong>podcast description</strong> — this helps with discoverability</span>
          </li>
          <li className="flex items-start space-x-2">
            <span className="text-green-500 shrink-0 mt-0.5">&#10003;</span>
            <span>New episodes will appear automatically on all platforms once your feed is submitted</span>
          </li>
          <li className="flex items-start space-x-2">
            <span className="text-green-500 shrink-0 mt-0.5">&#10003;</span>
            <span>Updates may take a few hours to propagate across platforms</span>
          </li>
        </ul>
      </div>
    </div>
  )
}

export default PodcastDistribution
