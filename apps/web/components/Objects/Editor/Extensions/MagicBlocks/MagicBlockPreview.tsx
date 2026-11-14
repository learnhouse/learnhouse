import React from 'react'
import { useTranslation } from 'react-i18next'
import { buildMagicDocument } from './magicModel'
import { useDocumentTheme } from '@components/Objects/Activities/BlockTheme/BlockThemeScope'
import { injectDocumentTheme } from '@components/Objects/Activities/BlockTheme/blockTheme'

interface MagicBlockPreviewProps {
  htmlContent: string | null
  /** Streaming in: skip the loading shimmer, the document changes every chunk. */
  streaming?: boolean
}

/**
 * Sandboxed iframe for Magic block HTML.
 *
 * The document goes in through srcDoc rather than a blob: URL, because a blob
 * document inherits the creating page's origin, whereas a srcDoc frame without
 * allow-same-origin lands on an opaque one.
 */
function MagicBlockPreview({ htmlContent, streaming = false }: MagicBlockPreviewProps) {
  const { t } = useTranslation()
  const boxRef = React.useRef<HTMLDivElement>(null)
  // The lesson's block theme goes into the document (data-lh-theme + --lh-*
  // variables) so generated content can follow dark mode; see blockTheme.ts.
  const theme = useDocumentTheme(boxRef)
  const doc = React.useMemo(() => {
    const built = buildMagicDocument(htmlContent)
    return built ? injectDocumentTheme(built, theme) : built
  }, [htmlContent, theme])
  const [loadedDoc, setLoadedDoc] = React.useState<string | null>(null)
  const loading = !streaming && !!doc && loadedDoc !== doc

  if (!doc) return <div ref={boxRef} className="h-full w-full bg-neutral-50" />
  return (
    <div ref={boxRef} className="relative h-full w-full">
      {loading && (
        <div className="absolute inset-0 flex flex-col gap-3 bg-white p-6" aria-hidden>
          <div className="h-5 w-1/3 animate-pulse rounded-md bg-neutral-100" />
          <div className="h-3 w-2/3 animate-pulse rounded-md bg-neutral-100" />
          <div className="mt-2 flex-1 animate-pulse rounded-xl bg-neutral-100/80" />
        </div>
      )}
      <iframe
        srcDoc={doc}
        onLoad={() => setLoadedDoc(doc)}
        className="block h-full w-full bg-white"
        style={{ border: 'none' }}
        sandbox="allow-scripts"
        title={t('editor.blocks.magic_block_content.preview_title')}
      />
    </div>
  )
}

export default MagicBlockPreview
