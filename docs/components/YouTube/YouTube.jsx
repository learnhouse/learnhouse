import { VIDEOS } from '../../lib/videos'

// Embeds a video guide from lib/videos.js. Renders nothing while the video has
// no YouTube ID yet, so a page can hold the slot before the video is public.
export default function YouTube({ video }) {
  const entry = VIDEOS[video]
  if (!entry?.youtubeId) return null

  return (
    <figure className="lh-video">
      <div className="lh-video-frame">
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${entry.youtubeId}?rel=0`}
          title={entry.title}
          loading="lazy"
          allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          referrerPolicy="strict-origin-when-cross-origin"
          allowFullScreen
        />
      </div>
      <figcaption>{entry.title}</figcaption>
    </figure>
  )
}
