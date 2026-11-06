'use client'

import { useState } from 'react'

/** The running demo in a browser frame; its screenshot shows until it loads. */
export default function LiveFrame({ src, poster, title }) {
  const [loaded, setLoaded] = useState(false)
  return (
    <div className="lhdm-frame">
      <div className="lhdm-frame-bar">
        <i />
        <i />
        <i />
        <span>{src.replace(/^https?:\/\//, '')}</span>
      </div>
      <div className="lhdm-frame-body">
        <img src={poster} alt="" aria-hidden className={`lhdm-frame-poster ${loaded ? 'lhdm-hidden' : ''}`} />
        <iframe
          src={src}
          title={`${title}, live demo`}
          loading="lazy"
          onLoad={() => setLoaded(true)}
          className={loaded ? '' : 'lhdm-hidden'}
          allow="clipboard-write; microphone; autoplay"
        />
      </div>
    </div>
  )
}
