// Certificate PDF export.
//
// The PDF is produced by rasterising the SAME <CertificatePreview> React
// component that is shown on screen and in the admin editor. It used to be
// built from a separate hand-written HTML string, which drifted badly from the
// component: the downloaded file lost the pattern artwork, the org logo and
// name, used an emoji instead of the award mark, and re-derived its own colour
// palette. Anything rendered here is by construction identical to the preview,
// so the two can no longer diverge.
//
// Keep this as the only place that turns a certificate into a PDF.

/** Width, in CSS pixels, of the offscreen node we rasterise. Roughly A4
 *  landscape at 96dpi, so the capture is dense enough to stay crisp when
 *  scaled into the page. */
export const CERTIFICATE_CAPTURE_WIDTH = 1123

/** Rasterise `node` and save it as a single-page PDF sized to the node's own
 *  aspect ratio, centred on A4 with a small margin. */
export async function downloadCertificateNodeAsPdf(
  node: HTMLElement,
  fileName: string,
): Promise<void> {
  const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
    // html2canvas-pro understands modern CSS color functions (oklch/lab/
    // color-mix) emitted by Tailwind v4; classic html2canvas throws on them.
    import('html2canvas-pro'),
    import('jspdf'),
  ])

  // Wait for webfonts before rasterising. html2canvas snapshots whatever is
  // painted at that instant, so if the Arabic face hasn't loaded yet the PDF
  // is written with fallback glyphs — or tofu — and nobody notices, because
  // the on-screen certificate looks fine by the time anyone opens the file.
  try {
    await document.fonts?.ready
  } catch {
    // Font Loading API unavailable — proceed; worst case is a fallback face.
  }

  const canvas = await html2canvas(node, {
    scale: 2, // Higher resolution
    useCORS: true, // org logo is served from the media host
    allowTaint: true,
    backgroundColor: '#ffffff',
  })

  const imgData = canvas.toDataURL('image/png')

  // Match page orientation to the certificate so we don't letterbox a wide
  // design into a tall page (or vice versa).
  const isLandscape = canvas.width >= canvas.height
  const pdf = new jsPDF(isLandscape ? 'landscape' : 'portrait', 'mm', 'a4')

  const pageWidth = pdf.internal.pageSize.getWidth()
  const pageHeight = pdf.internal.pageSize.getHeight()
  const margin = 8 // mm

  // Preserve aspect ratio: scale to whichever axis runs out of room first.
  const maxWidth = pageWidth - margin * 2
  const maxHeight = pageHeight - margin * 2
  const scale = Math.min(maxWidth / canvas.width, maxHeight / canvas.height)
  const imgWidth = canvas.width * scale
  const imgHeight = canvas.height * scale

  pdf.addImage(
    imgData,
    'PNG',
    (pageWidth - imgWidth) / 2,
    (pageHeight - imgHeight) / 2,
    imgWidth,
    imgHeight,
  )

  pdf.save(fileName)
}

/** Build a filesystem-safe PDF filename from the certification name. */
export function certificateFileName(certificationName?: string): string {
  const base = (certificationName || 'Certificate').replace(/[^a-zA-Z0-9]/g, '_')
  return `${base}_Certificate.pdf`
}
