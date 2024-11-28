import { NodeViewWrapper } from '@tiptap/react'
import React, { useState, useRef, useEffect, useMemo } from 'react'
import { Upload, Link as LinkIcon, GripVertical, GripHorizontal, AlignCenter, Cuboid, Code } from 'lucide-react'
import { useEditorProvider } from '@components/Contexts/Editor/EditorContext'
import { SiGithub, SiReplit, SiSpotify, SiLoom, SiGooglemaps, SiCodepen, SiCanva, SiNotion, SiGoogledocs, SiGitlab, SiX, SiFigma, SiGiphy } from '@icons-pack/react-simple-icons'
import { useRouter } from 'next/navigation'
import DOMPurify from 'dompurify'

// Add new type for script-based embeds
const SCRIPT_BASED_EMBEDS = {
  twitter: { src: 'https://platform.twitter.com/widgets.js', identifier: 'twitter-tweet' },
  instagram: { src: 'https://www.instagram.com/embed.js', identifier: 'instagram-media' },
  tiktok: { src: 'https://www.tiktok.com/embed.js', identifier: 'tiktok-embed' },
  // Add more platforms as needed
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
    return (
      <iframe 
        src={embedUrl} 
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

  const resizeRef = useRef<HTMLDivElement>(null)
  const editorState = useEditorProvider() as any
  const isEditable = editorState.isEditable
  const router = useRouter()

  const supportedProducts = [
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
      const sanitizedUrl = DOMPurify.sanitize(newUrl);
      setEmbedUrl(sanitizedUrl);
      props.updateAttributes({
        embedUrl: sanitizedUrl,
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

  return (
    <NodeViewWrapper className="embed-block">
      <div 
        ref={resizeRef}
        className={`relative bg-gray-100 rounded-lg overflow-hidden flex justify-center items-center ${alignment === 'center' ? 'mx-auto' : ''}`}
        style={{ height: `${embedHeight}px`, width: embedWidth, minWidth: '400px' }}
      >
        {(embedUrl || sanitizedEmbedCode) ? embedContent : (
          <div className="w-full h-full flex flex-col items-center justify-center p-6">
            <p className="text-gray-500 mb-4 font-medium tracking-tighter text-lg">Add an embed from :</p>
            <div className="flex flex-wrap gap-5 justify-center">
              {supportedProducts.map((product) => (
                <button
                  key={product.name}
                  className="flex flex-col items-center group transition-transform hover:scale-110"
                  onClick={() => handleProductClick(product.guide)}
                >
                  <div className="w-12 h-12 rounded-lg flex items-center justify-center shadow-md group-hover:shadow-lg transition-shadow" style={{ backgroundColor: product.color }}>
                    <product.icon size={24} color="#FFFFFF" />
                  </div>
                  <span className="text-xs mt-2 text-gray-700 group-hover:text-gray-900 font-medium">{product.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="absolute top-2 left-2 p-1 bg-white bg-opacity-70 rounded-md">
          <Cuboid size={16} className="text-gray-600" />
        </div>
        {isEditable && (
          <>
            <div className="absolute bottom-2 left-2 flex gap-2">
              <button
                onClick={() => handleEmbedTypeChange('url')}
                className={`p-2 rounded-md transition-colors ${embedType === 'url' ? 'bg-blue-500 text-white' : 'bg-white bg-opacity-70 text-gray-600'}`}
              >
                <LinkIcon size={16} />
              </button>
              <button
                onClick={() => handleEmbedTypeChange('code')}
                className={`p-2 rounded-md transition-colors ${embedType === 'code' ? 'bg-blue-500 text-white' : 'bg-white bg-opacity-70 text-gray-600'}`}
              >
                <Code size={16} />
              </button>
              {embedType === 'url' ? (
                <input
                  type="text"
                  value={embedUrl}
                  onChange={handleUrlChange}
                  className="p-2 bg-white bg-opacity-70 rounded-md w-64"
                  placeholder="Enter embed URL"
                />
              ) : (
                <textarea
                  value={embedCode}
                  onChange={handleCodeChange}
                  className="p-2 bg-white bg-opacity-70 rounded-md w-64 h-20"
                  placeholder="Enter embed code"
                />
              )}
            </div>
            <button
              onClick={handleCenterBlock}
              className="absolute bottom-2 right-2 p-2 bg-white bg-opacity-70 rounded-md hover:bg-opacity-100 transition-opacity"
            >
              <AlignCenter size={16} className="text-gray-600" />
            </button>
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

