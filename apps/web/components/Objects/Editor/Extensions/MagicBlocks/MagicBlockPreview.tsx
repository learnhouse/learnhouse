import React from 'react'
import { Loader2 } from 'lucide-react'
import { extractHtmlDocument } from './extractHtml'

interface MagicBlockPreviewProps {
  htmlContent: string | null
  isLoading?: boolean
  streamingContent?: string
}

/**
 * Sandboxed iframe preview for MagicBlock HTML content
 * Uses blob URLs and sandbox attributes for security
 */
function MagicBlockPreview({
  htmlContent,
  isLoading = false,
  streamingContent = '',
}: MagicBlockPreviewProps) {
  const iframeRef = React.useRef<HTMLIFrameElement>(null)
  const [blobUrl, setBlobUrl] = React.useState<string | null>(null)

  // Content to render (prioritize streaming content, then saved content)
  const contentToRender = streamingContent || htmlContent

  // Create blob URL for secure iframe content
  React.useEffect(() => {
    if (!contentToRender) {
      setBlobUrl(null)
      return
    }

    let html = extractHtmlDocument(contentToRender) || contentToRender

    // Wrap content with security headers if it's not a complete document
    let wrappedHtml = html
    if (!html.trim().toLowerCase().startsWith('<!doctype')) {
      wrappedHtml = `<!DOCTYPE html>
<html style="height: 100%; width: 100%;">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: https:; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.tailwindcss.com https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://d3js.org https://unpkg.com https://cdn.plot.ly https://cdn.babylonjs.com; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://fonts.googleapis.com https://unpkg.com; img-src 'self' data: blob: https:; font-src 'self' data: https://fonts.gstatic.com https://cdn.jsdelivr.net; connect-src 'self' https:; media-src 'self' https: data: blob:;">
  <style>
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
  </style>
</head>
<body>
${html}
</body>
</html>`
    }

    // Create blob URL
    const blob = new Blob([wrappedHtml], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    setBlobUrl(url)

    // Cleanup
    return () => {
      URL.revokeObjectURL(url)
    }
  }, [contentToRender])

  // Show loading state
  if (isLoading && !streamingContent) {
    return (
      <div className="flex items-center justify-center w-full h-full bg-black/30" style={{ minHeight: '100%' }}>
        <div className="text-center space-y-3">
          <Loader2 className="w-8 h-8 animate-spin mx-auto text-purple-400" />
          <p className="text-sm text-white/50">Generating interactive content...</p>
        </div>
      </div>
    )
  }

  // Show empty state
  if (!blobUrl && !isLoading) {
    return (
      <div className="flex items-center justify-center w-full h-full bg-black/30 border-2 border-dashed border-white/10" style={{ minHeight: '100%' }}>
        <div className="text-center space-y-2 px-4">
          <div className="text-4xl">✨</div>
          <p className="text-sm text-white/50">
            Describe what you want to create and watch the magic happen!
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="relative w-full h-full" style={{ minHeight: 0 }}>
      {isLoading && streamingContent && (
        <div className="absolute top-4 right-4 z-10 flex items-center gap-2 bg-black/70 backdrop-blur-sm px-3 py-1.5 rounded-full shadow-sm ring-1 ring-inset ring-white/10">
          <Loader2 className="w-4 h-4 animate-spin text-purple-400" />
          <span className="text-xs text-white/70">Generating...</span>
        </div>
      )}
      <iframe
        ref={iframeRef}
        src={blobUrl || undefined}
        className="w-full h-full bg-white block"
        style={{ border: 'none', minHeight: '100%' }}
        sandbox="allow-scripts allow-same-origin"
        title="MagicBlock Preview"
      />
    </div>
  )
}

export default MagicBlockPreview
