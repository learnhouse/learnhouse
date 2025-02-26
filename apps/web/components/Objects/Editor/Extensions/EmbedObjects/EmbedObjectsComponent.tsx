import { NodeViewWrapper } from '@tiptap/react'
import React, { useState, useRef, useEffect, useMemo } from 'react'
import { Upload, Link as LinkIcon, GripVertical, GripHorizontal, AlignCenter, Cuboid, Code } from 'lucide-react'
import { useEditorProvider } from '@components/Contexts/Editor/EditorContext'
import { SiGithub, SiReplit, SiSpotify, SiLoom, SiGooglemaps, SiCodepen, SiCanva, SiNotion, SiGoogledocs, SiGitlab, SiX, SiFigma, SiGiphy, SiYoutube } from '@icons-pack/react-simple-icons'
import { useRouter } from 'next/navigation'
import DOMPurify from 'dompurify'

// Add new type for script-based embeds
const SCRIPT_BASED_EMBEDS = {
  twitter: { src: 'https://platform.twitter.com/widgets.js', identifier: 'twitter-tweet' },
  instagram: { src: 'https://www.instagram.com/embed.js', identifier: 'instagram-media' },
  tiktok: { src: 'https://www.tiktok.com/embed.js', identifier: 'tiktok-embed' },
  // Add more platforms as needed
};

// Helper function to convert YouTube URLs to embed format
const getYouTubeEmbedUrl = (url: string): string => {
  try {
    // First validate that this is a proper URL
    const parsedUrl = new URL(url);
    
    // Ensure the hostname is actually YouTube
    const isYoutubeHostname = 
      parsedUrl.hostname === 'youtube.com' || 
      parsedUrl.hostname === 'www.youtube.com' || 
      parsedUrl.hostname === 'youtu.be' || 
      parsedUrl.hostname === 'www.youtu.be';
    
    if (!isYoutubeHostname) {
      return url; // Not a YouTube URL, return as is
    }
    
    // Handle different YouTube URL formats with a more precise regex
    const youtubeRegex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i;
    const match = url.match(youtubeRegex);
    
    if (match && match[1]) {
      // Validate the video ID format (should be exactly 11 characters)
      const videoId = match[1];
      if (videoId.length === 11) {
        // Return the embed URL with the video ID and secure protocol
        return `https://www.youtube.com/embed/${videoId}?autoplay=0&rel=0`;
      }
    }
    
    // If no valid match found, return the original URL
    return url;
  } catch (e) {
    // If URL parsing fails, return the original URL
    return url;
  }
};

// Add new memoized component for the embed content
const MemoizedEmbed = React.memo(({ embedUrl, sanitizedEmbedCode, embedType }: {
  embedUrl: string;
  sanitizedEmbedCode: string;
  embedType: 'url' | 'code';
}) => {
  useEffect(() => {
    if (embedType === 'code' && sanitizedEmbedCode) {
      // Check for any matching script-based embeds
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
    // Process the URL if it's a YouTube URL - using proper URL validation
    let isYoutubeUrl = false;
    
    try {
      const url = new URL(embedUrl);
      // Check if the hostname is exactly youtube.com or youtu.be (or www variants)
      isYoutubeUrl = url.hostname === 'youtube.com' || 
                     url.hostname === 'www.youtube.com' || 
                     url.hostname === 'youtu.be' || 
                     url.hostname === 'www.youtu.be';
    } catch (e) {
      // Invalid URL format, not a YouTube URL
      isYoutubeUrl = false;
    }
    
    const processedUrl = isYoutubeUrl ? getYouTubeEmbedUrl(embedUrl) : embedUrl;
      
    return (
      <iframe 
        src={processedUrl} 
        className="w-full h-full"
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
  const router = useRouter()

  // Add ResizeObserver to track parent container size changes
  useEffect(() => {
    const updateDimensions = () => {
      if (containerRef.current && containerRef.current.parentElement) {
        const parentElement = containerRef.current.parentElement;
        const newParentWidth = parentElement.offsetWidth;
        setParentWidth(newParentWidth);
        
        // Check if we're in a mobile viewport
        setIsMobile(newParentWidth < 640); // 640px is a common breakpoint for small screens
        
        // If embedWidth is set to a percentage, maintain that percentage
        // Otherwise, adjust to fit parent width
        if (typeof embedWidth === 'string' && embedWidth.endsWith('%')) {
          const percentage = parseInt(embedWidth, 10);
          const newWidth = `${Math.min(100, percentage)}%`;
          setEmbedWidth(newWidth);
          props.updateAttributes({ embedWidth: newWidth });
        } else if (newParentWidth < parseInt(String(embedWidth), 10)) {
          // If parent is smaller than current width, adjust to fit
          setEmbedWidth('100%');
          props.updateAttributes({ embedWidth: '100%' });
        }
      }
    };

    // Initialize dimensions
    updateDimensions();

    // Set up ResizeObserver
    const resizeObserver = new ResizeObserver(() => {
      updateDimensions();
    });

    if (containerRef.current && containerRef.current.parentElement) {
      resizeObserver.observe(containerRef.current.parentElement);
    }

    // Clean up
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
    { name: 'CodePen', icon: SiCodepen, color: '#000000', guide: 'https://blog.codepen.io/documentation/embedded-pens/' },
    { name: 'Canva', icon: SiCanva, color: '#00C4CC', guide: 'https://www.canva.com/help/article/embed-designs' },
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

  const handleEmbedTypeChange = (type: 'url' | 'code') => {
    setEmbedType(type)
    props.updateAttributes({ embedType: type })
  }

  const handleUrlChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const newUrl = event.target.value;
    const trimmedUrl = newUrl.trim();
    
    // Only update if URL is not just whitespace
    if (newUrl === '' || trimmedUrl) {
      // First sanitize with DOMPurify
      const sanitizedUrl = DOMPurify.sanitize(newUrl);
      
      // Additional URL validation for security
      let validatedUrl = sanitizedUrl;
      
      if (sanitizedUrl) {
        try {
          // Ensure it's a valid URL by parsing it
          const url = new URL(sanitizedUrl);
          
          // Only allow http and https protocols
          if (url.protocol !== 'http:' && url.protocol !== 'https:') {
            // If invalid protocol, default to https
            url.protocol = 'https:';
            validatedUrl = url.toString();
          }
        } catch (e) {
          // If it's not a valid URL, prepend https:// to make it valid
          // Only do this if it's not empty and doesn't already start with a protocol
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
    // Only update if code is not just whitespace
    if (newCode === '' || trimmedCode) {
      setEmbedCode(newCode);
      props.updateAttributes({
        embedCode: newCode,
        embedType: 'code',
      });
    }
  };

  // Add refs for storing dimensions during resize
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
          
          // Update ref and DOM directly during resize
          dimensionsRef.current.width = newWidthValue
          resizeRef.current.style.width = newWidthValue
        } else {
          const newHeight = Math.max(100, startHeight + e.clientY - startY)
          
          // Update ref and DOM directly during resize
          dimensionsRef.current.height = newHeight
          resizeRef.current.style.height = `${newHeight}px`
        }
      }
    }

    const handleMouseUp = () => {
      setIsResizing(false)
      // Only update state and attributes after resize is complete
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

  const handleProductClick = (guide: string) => {
    window.open(guide, '_blank', 'noopener,noreferrer')
  }

  // Calculate responsive styles based on parent width
  const getResponsiveStyles = () => {
    // Default styles
    const styles: React.CSSProperties = {
      height: `${embedHeight}px`,
      width: embedWidth,
    };

    // If parent width is available, ensure we don't exceed it
    if (parentWidth) {
      // For mobile viewports, always use 100% width
      if (isMobile) {
        styles.width = '100%';
        styles.minWidth = 'unset';
      } else {
        // For desktop, use the set width but ensure it's not wider than parent
        styles.minWidth = Math.min(parentWidth, 400) + 'px';
        styles.maxWidth = '100%';
      }
    }

    return styles;
  };

  // Memoize the embed content
  const embedContent = useMemo(() => (
    !isResizing && (embedUrl || sanitizedEmbedCode) ? (
      <MemoizedEmbed 
        embedUrl={embedUrl}
        sanitizedEmbedCode={sanitizedEmbedCode}
        embedType={embedType}
      />
    ) : (
      <div className="w-full h-full bg-gray-200" />
    )
  ), [embedUrl, sanitizedEmbedCode, embedType, isResizing]);

  // Input states
  const [activeInput, setActiveInput] = useState<'none' | 'url' | 'code'>('none');
  const [selectedProduct, setSelectedProduct] = useState<typeof supportedProducts[0] | null>(null);
  const urlInputRef = useRef<HTMLInputElement>(null);
  const codeInputRef = useRef<HTMLTextAreaElement>(null);

  // Handle direct input from product selection
  const handleProductSelection = (product: typeof supportedProducts[0]) => {
    // Set the input type to URL by default
    setEmbedType('url');
    setActiveInput('url');
    
    // Store the selected product for the popup
    setSelectedProduct(product);
    
    // Focus the URL input after a short delay to allow rendering
    setTimeout(() => {
      if (urlInputRef.current) {
        urlInputRef.current.focus();
      }
    }, 50);
  };

  // Handle input submission
  const handleInputSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setActiveInput('none');
  };

  // Handle escape key to cancel input
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setActiveInput('none');
    }
  };

  // Handle opening documentation
  const handleOpenDocs = (guide: string) => {
    window.open(guide, '_blank', 'noopener,noreferrer');
  };

  return (
    <NodeViewWrapper className="embed-block w-full" ref={containerRef}>
      <div 
        ref={resizeRef}
        className={`relative bg-gray-100 rounded-lg overflow-hidden flex justify-center items-center ${alignment === 'center' ? 'mx-auto' : ''}`}
        style={getResponsiveStyles()}
      >
        {(embedUrl || sanitizedEmbedCode) ? (
          // Show the embed content if we have a URL or code
          <>
            {embedContent}
            
            {/* Minimal toolbar for existing embeds */}
            {isEditable && (
              <div className="absolute top-2 right-2 flex items-center gap-1.5 bg-white bg-opacity-90 backdrop-blur-sm rounded-lg p-1 shadow-sm transition-opacity opacity-70 hover:opacity-100">
                <button
                  onClick={() => setActiveInput(embedType)}
                  className="p-1.5 rounded-md hover:bg-gray-100 text-gray-600"
                  title="Edit embed"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3Z"></path>
                  </svg>
                </button>
                <button
                  onClick={handleCenterBlock}
                  className="p-1.5 rounded-md hover:bg-gray-100 text-gray-600"
                  title={alignment === 'center' ? 'Align left' : 'Center align'}
                >
                  <AlignCenter size={16} />
                </button>
                <button
                  onClick={() => {
                    setEmbedUrl('');
                    setEmbedCode('');
                    props.updateAttributes({ 
                      embedUrl: '',
                      embedCode: ''
                    });
                  }}
                  className="p-1.5 rounded-md hover:bg-gray-100 text-gray-600"
                  title="Remove embed"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 6h18"></path>
                    <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path>
                    <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path>
                  </svg>
                </button>
              </div>
            )}
          </>
        ) : (
          // Show the embed selection UI if we don't have content yet
          <div className="w-full h-full flex flex-col items-center justify-center p-2 sm:p-6">
            <p className="text-gray-500 mb-2 sm:mb-4 font-medium tracking-tighter text-base sm:text-lg text-center">Add an embed from :</p>
            <div className="flex flex-wrap gap-2 sm:gap-5 justify-center">
              {supportedProducts.map((product) => (
                <button
                  key={product.name}
                  className="flex flex-col items-center group transition-transform hover:scale-110"
                  onClick={() => handleProductSelection(product)}
                  title={`Add ${product.name} embed`}
                >
                  <div className="w-8 h-8 sm:w-12 sm:h-12 rounded-lg flex items-center justify-center shadow-md group-hover:shadow-lg transition-shadow" style={{ backgroundColor: product.color }}>
                    <product.icon size={isMobile ? 16 : 24} color="#FFFFFF" />
                  </div>
                  <span className="text-xs mt-1 sm:mt-2 text-gray-700 group-hover:text-gray-900 font-medium">{product.name}</span>
                </button>
              ))}
            </div>
            
            <p className="text-xs text-gray-500 mt-3 mb-2 text-center max-w-md">
              Click a service to add an embed
            </p>
            
            {/* Direct input options */}
            {isEditable && (
              <div className="mt-4 flex gap-3 justify-center">
                <button
                  onClick={() => {
                    setEmbedType('url');
                    setActiveInput('url');
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-white rounded-lg shadow-sm hover:shadow-md transition-all text-sm text-gray-700"
                >
                  <LinkIcon size={14} />
                  <span>URL</span>
                </button>
                <button
                  onClick={() => {
                    setEmbedType('code');
                    setActiveInput('code');
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-white rounded-lg shadow-sm hover:shadow-md transition-all text-sm text-gray-700"
                >
                  <Code size={14} />
                  <span>Code</span>
                </button>
              </div>
            )}
          </div>
        )}
        
        {/* Inline input UI - appears in place without covering content */}
        {isEditable && activeInput !== 'none' && (
          <div className="absolute inset-0 bg-gray-100 bg-opacity-95 backdrop-blur-sm flex items-center justify-center p-4 z-10">
            <form 
              onSubmit={handleInputSubmit}
              className="w-full max-w-lg bg-white rounded-xl shadow-lg p-4"
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
                  <h3 className="text-lg font-medium text-gray-800">
                    {activeInput === 'url' 
                      ? (selectedProduct ? `Add ${selectedProduct.name} Embed` : 'Add Embed URL') 
                      : 'Add Embed Code'}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveInput('none')}
                  className="p-1 rounded-full hover:bg-gray-100 text-gray-500"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                  </svg>
                </button>
              </div>
              
              {activeInput === 'url' ? (
                <>
                  <div className="relative mb-2">
                    <div className="absolute left-3 top-1/2 transform -translate-y-1/2 text-blue-500">
                      <LinkIcon size={16} />
                    </div>
                    <input
                      ref={urlInputRef}
                      type="text"
                      value={embedUrl}
                      onChange={handleUrlChange}
                      className="w-full pl-10 pr-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:outline-none transition-all"
                      placeholder={selectedProduct ? `Paste ${selectedProduct.name} embed URL` : "Paste embed URL (YouTube, Spotify, etc.)"}
                      autoFocus
                    />
                  </div>
                  <div className="flex justify-between items-center mb-4">
                    <p className="text-xs text-gray-500">
                      Tip: Paste any {selectedProduct?.name || "YouTube, Spotify, or other"} embed URL directly
                    </p>
                    {selectedProduct && (
                      <button
                        type="button"
                        onClick={() => handleOpenDocs(selectedProduct.guide)}
                        className="text-xs text-blue-500 hover:text-blue-700 flex items-center gap-1"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="10"></circle>
                          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path>
                          <line x1="12" y1="17" x2="12.01" y2="17"></line>
                        </svg>
                        How to embed {selectedProduct.name}
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
                      className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl h-32 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:outline-none transition-all font-mono text-sm"
                      placeholder="Paste embed code (iframe, embed script, etc.)"
                      autoFocus
                    />
                  </div>
                  <div className="flex justify-between items-center mb-4">
                    <p className="text-xs text-gray-500">
                      Tip: Paste iframe or embed code from any platform
                    </p>
                    {selectedProduct && (
                      <button
                        type="button"
                        onClick={() => handleOpenDocs(selectedProduct.guide)}
                        className="text-xs text-blue-500 hover:text-blue-700 flex items-center gap-1"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="10"></circle>
                          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path>
                          <line x1="12" y1="17" x2="12.01" y2="17"></line>
                        </svg>
                        How to embed {selectedProduct.name}
                      </button>
                    )}
                  </div>
                </>
              )}
              
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setActiveInput('none')}
                  className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-500 text-white rounded-lg text-sm font-medium hover:bg-blue-600 transition-colors"
                  disabled={(activeInput === 'url' && !embedUrl) || (activeInput === 'code' && !embedCode)}
                >
                  Apply
                </button>
              </div>
            </form>
          </div>
        )}
        
        {/* Resize handles */}
        {isEditable && (
          <>
            <div
              className="absolute right-0 top-0 bottom-0 w-4 cursor-ew-resize flex items-center justify-center bg-white bg-opacity-70 hover:bg-opacity-100 transition-opacity"
              onMouseDown={(e) => handleResizeStart(e, 'horizontal')}
            >
              <GripVertical size={16} className="text-gray-600" />
            </div>
            <div
              className="absolute left-0 right-0 bottom-0 h-4 cursor-ns-resize flex items-center justify-center bg-white bg-opacity-70 hover:bg-opacity-100 transition-opacity"
              onMouseDown={(e) => handleResizeStart(e, 'vertical')}
            >
              <GripHorizontal size={16} className="text-gray-600" />
            </div>
          </>
        )}
      </div>
    </NodeViewWrapper>
  )
}

export default EmbedObjectsComponent

