import { NextRequest, NextResponse } from 'next/server'
import { getPodcastMeta } from '@services/podcasts/podcasts'
import { getOrganizationContextInfo } from '@services/organizations/orgs'
import { getUriWithOrg } from '@services/config/config'
import { getPodcastThumbnailMediaDirectory, getEpisodeAudioMediaDirectory, getEpisodeThumbnailMediaDirectory } from '@services/media/media'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ podcastuuid: string }> }
) {
  const { podcastuuid } = await params
  const orgSlug = request.headers.get('X-Feed-Orgslug') || request.nextUrl.searchParams.get('orgslug')

  if (!orgSlug) {
    return NextResponse.json({ error: 'Missing org context' }, { status: 400 })
  }

  try {
    const org = await getOrganizationContextInfo(orgSlug, null)
    const podcastMeta = await getPodcastMeta(`podcast_${podcastuuid}`, null)

    if (!podcastMeta?.podcast) {
      return NextResponse.json({ error: 'Podcast not found' }, { status: 404 })
    }

    const { podcast, episodes } = podcastMeta
    const baseUrl = getUriWithOrg(orgSlug, '/')
    const podcastUrl = `${baseUrl}podcast/${podcastuuid}`

    const imageUrl = podcast.thumbnail_image
      ? getPodcastThumbnailMediaDirectory(org.org_uuid, podcast.podcast_uuid, podcast.thumbnail_image)
      : ''

    // Build episodes XML
    const episodeItems = (episodes || [])
      .filter((ep: any) => ep.published)
      .sort((a: any, b: any) => b.episode_number - a.episode_number)
      .map((episode: any) => {
        const audioUrl = episode.audio_file
          ? getEpisodeAudioMediaDirectory(org.org_uuid, podcast.podcast_uuid, episode.episode_uuid, episode.audio_file)
          : ''
        const epImageUrl = episode.thumbnail_image
          ? getEpisodeThumbnailMediaDirectory(org.org_uuid, podcast.podcast_uuid, episode.episode_uuid, episode.thumbnail_image)
          : imageUrl
        const pubDate = episode.creation_date ? new Date(episode.creation_date).toUTCString() : ''
        const durationFormatted = formatDuration(episode.duration_seconds || 0)

        return `    <item>
      <title>${escapeXml(episode.title)}</title>
      <description>${escapeXml(episode.description || '')}</description>
      <pubDate>${pubDate}</pubDate>
      <enclosure url="${escapeXml(audioUrl)}" type="audio/mpeg" />
      <guid isPermaLink="false">${episode.episode_uuid}</guid>
      <itunes:episode>${episode.episode_number}</itunes:episode>
      <itunes:duration>${durationFormatted}</itunes:duration>
      <itunes:summary>${escapeXml(episode.description || '')}</itunes:summary>
      ${epImageUrl ? `<itunes:image href="${escapeXml(epImageUrl)}" />` : ''}
    </item>`
      }).join('\n')

    // Get author name from podcast authors array
    const authorName = podcast.authors?.[0]?.user
      ? `${podcast.authors[0].user.first_name} ${podcast.authors[0].user.last_name}`.trim()
      : org.name

    const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
  xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"
  xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(podcast.name)}</title>
    <link>${escapeXml(podcastUrl)}</link>
    <description>${escapeXml(podcast.description || podcast.about || '')}</description>
    <language>en</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <atom:link href="${escapeXml(`${baseUrl}api/podcast/${podcastuuid}/feed`)}" rel="self" type="application/rss+xml" />
    <itunes:author>${escapeXml(authorName)}</itunes:author>
    <itunes:summary>${escapeXml(podcast.description || podcast.about || '')}</itunes:summary>
    ${imageUrl ? `<itunes:image href="${escapeXml(imageUrl)}" />` : ''}
    ${imageUrl ? `<image>
      <url>${escapeXml(imageUrl)}</url>
      <title>${escapeXml(podcast.name)}</title>
      <link>${escapeXml(podcastUrl)}</link>
    </image>` : ''}
    <itunes:owner>
      <itunes:name>${escapeXml(authorName)}</itunes:name>
    </itunes:owner>
    <itunes:explicit>false</itunes:explicit>
    <itunes:type>episodic</itunes:type>
${episodeItems}
  </channel>
</rss>`

    return new NextResponse(rss, {
      headers: {
        'Content-Type': 'application/rss+xml; charset=utf-8',
        'Cache-Control': 'public, max-age=3600, s-maxage=3600',
      },
    })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to generate feed' }, { status: 500 })
  }
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function formatDuration(seconds: number): string {
  const hrs = Math.floor(seconds / 3600)
  const mins = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
  }
  return `${mins}:${String(secs).padStart(2, '0')}`
}
