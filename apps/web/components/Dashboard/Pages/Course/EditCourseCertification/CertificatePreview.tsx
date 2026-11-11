'use client'
import React, { useLayoutEffect, useRef, useState } from 'react'
import CertificateArtwork, {
  CERTIFICATE_HEIGHT,
  CERTIFICATE_WIDTH,
  CertificateArtworkProps,
} from '@components/Objects/Certificates/CertificateArtwork'

/**
 * A certificate scaled to the width of its container.
 *
 * The artwork is laid out at a fixed A4 size and shrunk with a transform, so a
 * thumbnail, the editor preview, the verification page and the PDF capture
 * (which renders this at CERTIFICATE_CAPTURE_WIDTH, i.e. scale 1) all show the
 * exact same certificate.
 */
function CertificatePreview(props: CertificateArtworkProps) {
  const boxRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState<number | null>(null)

  useLayoutEffect(() => {
    const box = boxRef.current
    if (!box) return
    const measure = () => setScale(box.getBoundingClientRect().width / CERTIFICATE_WIDTH)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(box)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={boxRef}
      dir="ltr"
      style={{ position: 'relative', width: '100%', aspectRatio: `${CERTIFICATE_WIDTH} / ${CERTIFICATE_HEIGHT}`, overflow: 'hidden' }}
    >
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          transformOrigin: 'top left',
          transform: `scale(${scale ?? 1})`,
          visibility: scale === null ? 'hidden' : 'visible',
        }}
      >
        <CertificateArtwork {...props} />
      </div>
    </div>
  )
}

export default CertificatePreview
