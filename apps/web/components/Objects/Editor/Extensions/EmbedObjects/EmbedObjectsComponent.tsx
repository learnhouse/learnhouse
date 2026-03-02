import { NodeViewWrapper } from '@tiptap/react'
import React, { useState, useRef, useEffect, useMemo } from 'react'
import { Link as LinkIcon, GripVertical, GripHorizontal, AlignCenter, Code, X, ExternalLink, Palette } from 'lucide-react'
import { useEditorProvider } from '@components/Contexts/Editor/EditorContext'
import { SiGithub, SiReplit, SiSpotify, SiLoom, SiGooglemaps, SiNotion, SiGoogledocs, SiX, SiFigma, SiGiphy, SiYoutube } from '@icons-pack/react-simple-icons'
import DOMPurify from 'dompurify'
import { cn } from '@/lib/utils'
import { useTranslation } from 'react-i18next'

// Add new type for script-based embeds
const SCRIPT_BASED_EMBEDS = {
  twitter: { src: 'https://platform.twitter.com/widgets.js', identifier: 'twitter-tweet' },
  instagram: { src: 'https://www.instagram.com/embed.js', identifier: 'instagram-media' },
  tiktok: { src: 'https://www.tiktok.com/embed.js', identifier: 'tiktok-embed' },
};

// Helper function to convert YouTube URLs to embed format
const getYouTubeEmbedUrl = (url: string): string => {
  try {
    const parsedUrl = new URL(url);

    const isYoutubeHostname =
      parsedUrl.hostname === 'youtube.com' ||
      parsedUrl.hostname === 'www.youtube.com' ||
      parsedUrl.hostname === 'youtu.be' ||
      parsedUrl.hostname === 'www.youtu.be';

    if (!isYoutubeHostname) {
      return url;
    }

    const youtubeRegex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i;
    const match = url.match(youtubeRegex);

    if (match && match[1]) {
      const videoId = match[1];
      if (videoId.length === 11) {
        return `https://www.youtube.com/embed/${videoId}?autoplay=0&rel=0`;
      }
    }

    return url;
  } catch (e) {
    return url;
  }
};

// Memoized component for the embed content
const MemoizedEmbed = React.memo(({ embedUrl, sanitizedEmbedCode, embedType }: {
  embedUrl: string;
  sanitizedEmbedCode: string;
  embedType: 'url' | 'code';
}) => {
  useEffect(() => {
    if (embedType === 'code' && sanitizedEmbedCode) {
      const matchingPlatform = Object.entries(SCRIPT_BASED_EMBEDS).find(([_, config]) =>
        sanitizedEmbedCode.includes(config.identifier)
      );

      if (matchingPlatform) {
        const [_, config] = matchingPlatform;
        const script = document.createElement('script');
        script.src = config.src;
        script.async = true;
        script.charset = 'utf-8';
        document.body.appendChild(script);

        return () => {
          document.body.removeChild(script);
        };
      }
    }
  }, [embedType, sanitizedEmbedCode]);

  if (embedType === 'url' && embedUrl) {
    let isYoutubeUrl = false;

    try {
      const url = new URL(embedUrl);
      isYoutubeUrl = url.hostname === 'youtube.com' ||
        url.hostname === 'www.youtube.com' ||
        url.hostname === 'youtu.be' ||
        url.hostname === 'www.youtu.be';
    } catch (e) {
      isYoutubeUrl = false;
    }

    const processedUrl = isYoutubeUrl ? getYouTubeEmbedUrl(embedUrl) : embedUrl;

    return (
      <iframe
        src={processedUrl}
        className="w-full h-full rounded-lg"
        frameBorder="0"
        allowFullScreen
      />
    );
  }

  if (embedType === 'code' && sanitizedEmbedCode) {
    return <div dangerouslySetInnerHTML={{ __html: sanitizedEmbedCode }} className="w-full h-full" />;
  }

  return null;
});
MemoizedEmbed.displayName = 'MemoizedEmbed';

function EmbedObjectsComponent(props: any) {
  const { t } = useTranslation()
  const [embedType, setEmbedType] = useState<'url' | 'code'>(props.node.attrs.embedType || 'url')
  const [embedUrl, setEmbedUrl] = useState(props.node.attrs.embedUrl || '')
  const [embedCode, setEmbedCode] = useState(props.node.attrs.embedCode || '')
  const [embedHeight, setEmbedHeight] = useState(props.node.attrs.embedHeight || 300)
  const [embedWidth, setEmbedWidth] = useState(props.node.attrs.embedWidth || '100%')
  const [alignment, setAlignment] = useState(props.node.attrs.alignment || 'left')
  const [isResizing, setIsResizing] = useState(false)
  const [parentWidth, setParentWidth] = useState<number | null>(null)
  const [isMobile, setIsMobile] = useState(false)

  const resizeRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const editorState = useEditorProvider() as any
  const isEditable = editorState.isEditable

  useEffect(() => {
    const updateDimensions = () => {
      if (containerRef.current && containerRef.current.parentElement) {
        const parentElement = containerRef.current.parentElement;
        const newParentWidth = parentElement.offsetWidth;
        setParentWidth(newParentWidth);
        setIsMobile(newParentWidth < 640);

        if (typeof embedWidth === 'string' && embedWidth.endsWith('%')) {
          const percentage = parseInt(embedWidth, 10);
          const newWidth = `${Math.min(100, percentage)}%`;
          setEmbedWidth(newWidth);
          props.updateAttributes({ embedWidth: newWidth });
        } else if (newParentWidth < parseInt(String(embedWidth), 10)) {
          setEmbedWidth('100%');
          props.updateAttributes({ embedWidth: '100%' });
        }
      }
    };

    updateDimensions();

    const resizeObserver = new ResizeObserver(() => {
      updateDimensions();
    });

    if (containerRef.current && containerRef.current.parentElement) {
      resizeObserver.observe(containerRef.current.parentElement);
    }

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  const supportedProducts = [
    { name: 'YouTube', icon: SiYoutube, color: '#FF0000', guide: 'https://support.google.com/youtube/answer/171780?hl=en' },
    { name: 'GitHub', icon: SiGithub, color: '#181717', guide: 'https://emgithub.com/' },
    { name: 'Replit', icon: SiReplit, color: '#F26207', guide: 'https://docs.replit.com/hosting/embedding-repls' },
    { name: 'Spotify', icon: SiSpotify, color: '#1DB954', guide: 'https://developer.spotify.com/documentation/embeds' },
    { name: 'Loom', icon: SiLoom, color: '#625DF5', guide: 'https://support.loom.com/hc/en-us/articles/360002208317-How-to-embed-your-video-into-a-webpage' },
    { name: 'GMaps', icon: SiGooglemaps, color: '#4285F4', guide: 'https://developers.google.com/maps/documentation/embed/get-started' },
    { name: 'CodePen', icon: Code, color: '#000000', guide: 'https://blog.codepen.io/documentation/embedded-pens/' },
    { name: 'Canva', icon: Palette, color: '#00C4CC', guide: 'https://www.canva.com/help/article/embed-designs' },
    { name: 'Notion', icon: SiNotion, color: '#878787', guide: 'https://www.notion.so/help/embed-and-connect-other-apps#7a70ac4b5c5f4ec889e69d262e0de9e7' },
    { name: 'G Docs', icon: SiGoogledocs, color: '#4285F4', guide: 'https://support.google.com/docs/answer/183965?hl=en&co=GENIE.Platform%3DDesktop' },
    { name: 'X', icon: SiX, color: '#000000', guide: 'https://help.twitter.com/en/using-twitter/how-to-embed-a-tweet' },
    { name: 'Figma', icon: SiFigma, color: '#F24E1E', guide: 'https://help.figma.com/hc/en-us/articles/360041057214-Embed-files-and-prototypes' },
    { name: 'Giphy', icon: SiGiphy, color: '#FF6666', guide: 'https://developers.giphy.com/docs/embed/' },
  ]

  const [sanitizedEmbedCode, setSanitizedEmbedCode] = useState('')

  useEffect(() => {
    if (embedType === 'code' && embedCode) {
      const sanitized = DOMPurify.sanitize(embedCode, {
        ADD_TAGS: ['iframe'],
        ADD_ATTR: ['*']
      })
      setSanitizedEmbedCode(sanitized)
    }
  }, [embedCode, embedType])

  const handleUrlChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const newUrl = event.target.value;
    const trimmedUrl = newUrl.trim();

    if (newUrl === '' || trimmedUrl) {
      const sanitizedUrl = DOMPurify.sanitize(newUrl);
      let validatedUrl = sanitizedUrl;

      if (sanitizedUrl) {
        try {
          const url = new URL(sanitizedUrl);
          if (url.protocol !== 'http:' && url.protocol !== 'https:') {
            url.protocol = 'https:';
            validatedUrl = url.toString();
          }
        } catch (e) {
          if (sanitizedUrl && !sanitizedUrl.match(/^[a-zA-Z]+:\/\//)) {
            validatedUrl = `https://${sanitizedUrl}`;
          }
        }
      }

      setEmbedUrl(validatedUrl);
      props.updateAttributes({
        embedUrl: validatedUrl,
        embedType: 'url',
      });
    }
  };

  const handleCodeChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newCode = event.target.value;
    const trimmedCode = newCode.trim();
    if (newCode === '' || trimmedCode) {
      setEmbedCode(newCode);
      props.updateAttributes({
        embedCode: newCode,
        embedType: 'code',
      });
    }
  };

  const dimensionsRef = useRef({
    width: props.node.attrs.embedWidth || '100%',
    height: props.node.attrs.embedHeight || 300
  })

  const handleResizeStart = (event: React.MouseEvent<HTMLDivElement>, direction: 'horizontal' | 'vertical') => {
    event.preventDefault()
    setIsResizing(true)
    const startX = event.clientX
    const startY = event.clientY
    const startWidth = resizeRef.current?.offsetWidth || 0
    const startHeight = resizeRef.current?.offsetHeight || 0

    const handleMouseMove = (e: MouseEvent) => {
      if (resizeRef.current) {
        if (direction === 'horizontal') {
          const newWidth = startWidth + e.clientX - startX
          const parentWidth = resizeRef.current.parentElement?.offsetWidth || 1
          const widthPercentage = Math.min(100, Math.max(10, (newWidth / parentWidth) * 100))
          const newWidthValue = `${widthPercentage}%`
          dimensionsRef.current.width = newWidthValue
          resizeRef.current.style.width = newWidthValue
        } else {
          const newHeight = Math.max(100, startHeight + e.clientY - startY)
          dimensionsRef.current.height = newHeight
          resizeRef.current.style.height = `${newHeight}px`
        }
      }
    }

    const handleMouseUp = () => {
      setIsResizing(false)
      setEmbedWidth(dimensionsRef.current.width)
      setEmbedHeight(dimensionsRef.current.height)
      props.updateAttributes({
        embedWidth: dimensionsRef.current.width,
        embedHeight: dimensionsRef.current.height
      })
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }

  const handleCenterBlock = () => {
    const newAlignment = alignment === 'center' ? 'left' : 'center'
    setAlignment(newAlignment)
    props.updateAttributes({ alignment: newAlignment })
  }

  const getResponsiveStyles = () => {
    const styles: React.CSSProperties = {
      height: `${embedHeight}px`,
      width: embedWidth,
    };

    if (parentWidth) {
      if (isMobile) {
        styles.width = '100%';
        styles.minWidth = 'unset';
      } else {
        styles.minWidth = Math.min(parentWidth, 400) + 'px';
        styles.maxWidth = '100%';
      }
    }

    return styles;
  };

  const embedContent = useMemo(() => (
    !isResizing && (embedUrl || sanitizedEmbedCode) ? (
      <MemoizedEmbed
        embedUrl={embedUrl}
        sanitizedEmbedCode={sanitizedEmbedCode}
        embedType={embedType}
      />
    ) : (
      <div className="w-full h-full bg-neutral-100 rounded-lg" />
    )
  ), [embedUrl, sanitizedEmbedCode, embedType, isResizing]);

  const [activeInput, setActiveInput] = useState<'none' | 'url' | 'code'>('none');
  const [selectedProduct, setSelectedProduct] = useState<typeof supportedProducts[0] | null>(null);
  const urlInputRef = useRef<HTMLInputElement>(null);
  const codeInputRef = useRef<HTMLTextAreaElement>(null);

  const handleProductSelection = (product: typeof supportedProducts[0]) => {
    setEmbedType('url');
    setActiveInput('url');
    setSelectedProduct(product);

    setTimeout(() => {
      if (urlInputRef.current) {
        urlInputRef.current.focus();
      }
    }, 50);
  };

  const handleInputSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setActiveInput('none');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setActiveInput('none');
    }
  };

  const handleOpenDocs = (guide: string) => {
    window.open(guide, '_blank', 'noopener,noreferrer');
  };

  const handleRemove = () => {
    setEmbedUrl('');
    setEmbedCode('');
    props.updateAttributes({
      embedUrl: '',
      embedCode: ''
    });
  };

  return (
    <NodeViewWrapper className="embed-block w-full" ref={containerRef}>
      <div className="bg-neutral-50 rounded-xl px-5 py-4 nice-shadow transition-all ease-linear">
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <ExternalLink className="text-neutral-400" size={16} />
            <span className="uppercase tracking-widest text-xs font-bold text-neutral-400">
              {t('editor.blocks.embed')}
            </span>
          </div>
          {(embedUrl || sanitizedEmbedCode) && isEditable && (
            <button
              onClick={handleRemove}
              className="text-neutral-400 hover:text-red-500 transition-colors"
            >
              <X size={16} />
            </button>
          )}
        </div>

        {/* Embed Container */}
        <div
          ref={resizeRef}
          className={cn(
            "relative bg-white rounded-lg overflow-hidden nice-shadow",
            alignment === 'center' && "mx-auto"
          )}
          style={getResponsiveStyles()}
        >
          {(embedUrl || sanitizedEmbedCode) ? (
            <>
              {embedContent}

              {/* Toolbar for existing embeds */}
              {isEditable && (
                <div className="absolute top-2 right-2 flex items-center gap-1 bg-white/90 backdrop-blur-sm rounded-lg p-1 opacity-70 hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => setActiveInput(embedType)}
                    className="p-1.5 rounded-md hover:bg-neutral-100 text-neutral-600"
                    title={t('editor.blocks.embed_block.edit_embed')}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3Z"></path>
                    </svg>
                  </button>
                  <button
                    onClick={handleCenterBlock}
                    className="p-1.5 rounded-md hover:bg-neutral-100 text-neutral-600"
                    title={alignment === 'center' ? t('editor.blocks.common.align_left') : t('editor.blocks.common.align_center')}
                  >
                    <AlignCenter size={16} />
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center p-4 sm:p-6">
              <p className="text-neutral-500 mb-4 font-medium text-base text-center">{t('editor.blocks.embed_block.add_embed_from')}</p>
              <div className="flex flex-wrap gap-3 sm:gap-4 justify-center mb-4">
                {supportedProducts.map((product) => (
                  <button
                    key={product.name}
                    className="flex flex-col items-center group transition-transform hover:scale-110"
                    onClick={() => handleProductSelection(product)}
                    title={`Add ${product.name} embed`}
                  >
                    <div
                      className="w-10 h-10 sm:w-12 sm:h-12 rounded-lg flex items-center justify-center shadow-md group-hover:shadow-lg transition-shadow"
                      style={{ backgroundColor: product.color }}
                    >
                      <product.icon size={isMobile ? 18 : 22} color="#FFFFFF" />
                    </div>
                    <span className="text-xs mt-1.5 text-neutral-600 group-hover:text-neutral-900 font-medium">{product.name}</span>
                  </button>
                ))}
              </div>

              <p className="text-xs text-neutral-500 mb-3 text-center">
                {t('editor.blocks.embed_block.click_service')}
              </p>

              {isEditable && (
                <div className="flex gap-2 justify-center">
                  <button
                    onClick={() => {
                      setEmbedType('url');
                      setActiveInput('url');
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-neutral-200 hover:bg-neutral-300 rounded-lg text-sm text-neutral-700 transition-colors"
                  >
                    <LinkIcon size={14} />
                    <span>URL</span>
                  </button>
                  <button
                    onClick={() => {
                      setEmbedType('code');
                      setActiveInput('code');
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-neutral-200 hover:bg-neutral-300 rounded-lg text-sm text-neutral-700 transition-colors"
                  >
                    <Code size={14} />
                    <span>Code</span>
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Input Overlay */}
          {isEditable && activeInput !== 'none' && (
            <div className="absolute inset-0 bg-neutral-50/95 backdrop-blur-sm flex items-center justify-center p-4 z-10">
              <form
                onSubmit={handleInputSubmit}
                className="w-full max-w-lg bg-white rounded-xl nice-shadow p-4"
                onKeyDown={handleKeyDown}
              >
                <div className="flex justify-between items-center mb-3">
                  <div className="flex items-center gap-2">
                    {selectedProduct && activeInput === 'url' && (
                      <div
                        className="w-8 h-8 rounded-lg flex items-center justify-center"
                        style={{ backgroundColor: selectedProduct.color }}
                      >
                        <selectedProduct.icon size={18} color="#FFFFFF" />
                      </div>
                    )}
                    <h3 className="text-base font-semibold text-neutral-800">
                      {activeInput === 'url'
                        ? (selectedProduct ? t('editor.blocks.embed_block.add_embed', { name: selectedProduct.name }) : t('editor.blocks.embed_block.add_embed_url'))
                        : t('editor.blocks.embed_block.add_embed_code')}
                    </h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveInput('none')}
                    className="p-1 rounded-full hover:bg-neutral-100 text-neutral-500"
                  >
                    <X size={20} />
                  </button>
                </div>

                {activeInput === 'url' ? (
                  <>
                    <div className="relative mb-2">
                      <div className="absolute left-3 top-1/2 transform -translate-y-1/2 text-neutral-500">
                        <LinkIcon size={16} />
                      </div>
                      <input
                        ref={urlInputRef}
                        type="text"
                        value={embedUrl}
                        onChange={handleUrlChange}
                        className="w-full pl-10 pr-4 py-2.5 bg-neutral-50 border border-neutral-200 rounded-lg focus:ring-2 focus:ring-neutral-400 focus:border-neutral-400 outline-none transition-all text-sm"
                        placeholder={selectedProduct ? t('editor.blocks.embed_block.paste_url', { name: selectedProduct.name }) : t('editor.blocks.embed_block.paste_any_url')}
                        autoFocus
                      />
                    </div>
                    <div className="flex justify-between items-center mb-4">
                      <p className="text-xs text-neutral-500">
                        {t('editor.blocks.embed_block.paste_directly')}
                      </p>
                      {selectedProduct && (
                        <button
                          type="button"
                          onClick={() => handleOpenDocs(selectedProduct.guide)}
                          className="text-xs text-neutral-500 hover:text-neutral-700 flex items-center gap-1"
                        >
                          {t('editor.blocks.embed_block.how_to_embed', { name: selectedProduct.name })}
                        </button>
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="relative mb-2">
                      <textarea
                        ref={codeInputRef}
                        value={embedCode}
                        onChange={handleCodeChange}
                        className="w-full p-3 bg-neutral-50 border border-neutral-200 rounded-lg h-32 focus:ring-2 focus:ring-neutral-400 focus:border-neutral-400 outline-none transition-all font-mono text-sm"
                        placeholder={t('editor.blocks.embed_block.paste_code')}
                        autoFocus
                      />
                    </div>
                    <p className="text-xs text-neutral-500 mb-4">
                      {t('editor.blocks.embed_block.paste_iframe')}
                    </p>
                  </>
                )}

                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setActiveInput('none')}
                    className="px-4 py-2 text-sm text-neutral-600 hover:text-neutral-800 rounded-lg transition-colors"
                  >
                    {t('editor.blocks.common.cancel')}
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 bg-neutral-700 hover:bg-neutral-800 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                    disabled={(activeInput === 'url' && !embedUrl) || (activeInput === 'code' && !embedCode)}
                  >
                    {t('editor.blocks.common.apply')}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Resize handles */}
          {isEditable && (embedUrl || sanitizedEmbedCode) && (
            <>
              <div
                className="absolute right-0 top-0 bottom-0 w-4 cursor-ew-resize flex items-center justify-center bg-white/70 hover:bg-white/90 transition-opacity"
                onMouseDown={(e) => handleResizeStart(e, 'horizontal')}
              >
                <GripVertical size={16} className="text-neutral-500" />
              </div>
              <div
                className="absolute left-0 right-0 bottom-0 h-4 cursor-ns-resize flex items-center justify-center bg-white/70 hover:bg-white/90 transition-opacity"
                onMouseDown={(e) => handleResizeStart(e, 'vertical')}
              >
                <GripHorizontal size={16} className="text-neutral-500" />
              </div>
            </>
          )}
        </div>
      </div>
    </NodeViewWrapper>
  )
}

export default EmbedObjectsComponent
