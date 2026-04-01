import React, { useEffect, useRef, useState, useCallback } from 'react'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { getAPIUrl } from '@services/config/config'
import { getScormContentUrl } from '@services/media/media'
import { RefreshCw, AlertCircle } from 'lucide-react'
import { ScormRuntimeAPI } from '../../services/scorm/ScormRuntimeAPI'

interface ScormActivityProps {
  activity: {
    activity_uuid: string
    activity_sub_type: string
    content: {
      scorm_version: string
      sco_identifier: string
      entry_point: string
      sco_title: string
    }
  }
  course: {
    course_uuid: string
  }
}

function ScormActivity({ activity, course }: ScormActivityProps) {
  const org = useOrg() as any
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token

  const iframeRef = useRef<HTMLIFrameElement>(null)
  const runtimeRef = useRef<ScormRuntimeAPI | null>(null)
  const initStartedRef = useRef(false)

  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [initialized, setInitialized] = useState(false)
  const [apiInjected, setApiInjected] = useState(false)

  // Get the content URL for the SCORM entry point
  const getContentUrl = useCallback(() => {
    if (!org?.org_uuid || !course?.course_uuid || !activity?.activity_uuid) {
      return null
    }
    return getScormContentUrl(
      org.org_uuid,
      course.course_uuid,
      activity.activity_uuid,
      activity.content.entry_point
    )
  }, [org?.org_uuid, course?.course_uuid, activity?.activity_uuid, activity?.content?.entry_point])

  // Initialize SCORM runtime
  useEffect(() => {
    // Use ref to prevent double initialization
    if (!access_token || !activity?.activity_uuid || initStartedRef.current) return
    initStartedRef.current = true

    const initializeRuntime = async () => {
      try {
        const apiUrl = getAPIUrl()

        // Create runtime API instance
        const runtime = new ScormRuntimeAPI(
          activity.activity_uuid,
          activity.content.scorm_version,
          access_token,
          apiUrl
        )

        // Initialize the session
        const success = await runtime.initialize()
        if (!success) {
          throw new Error('Runtime initialization returned false')
        }

        runtimeRef.current = runtime

        setInitialized(true)
        setError(null)
      } catch (err: any) {
        console.error('Failed to initialize SCORM runtime:', err)
        setError('Failed to initialize SCORM session')
        initStartedRef.current = false // Allow retry
      }
    }

    initializeRuntime()

    // Cleanup on unmount only
    return () => {
      if (runtimeRef.current) {
        console.log('[SCORM] Cleaning up runtime on unmount')
        runtimeRef.current.terminate()
        runtimeRef.current = null
      }
    }
  }, [access_token, activity?.activity_uuid, activity?.content?.scorm_version])

  // Inject SCORM API into window (where SCORM content looks for it)
  useEffect(() => {
    if (!runtimeRef.current || !initialized) return

    const runtime = runtimeRef.current

    // SCORM content looks for API in window.parent, window.top, or window.opener
    // We inject into the current window so the iframe can find it
    try {
      // Inject SCORM 1.2 API
      if (activity.content.scorm_version === 'SCORM_12') {
        (window as any).API = runtime.getScorm12API()
      }

      // Inject SCORM 2004 API
      if (activity.content.scorm_version === 'SCORM_2004') {
        (window as any).API_1484_11 = runtime.getScorm2004API()
      }

      // Mark API as injected so iframe can render
      setApiInjected(true)
    } catch (err) {
      console.error('Error injecting SCORM API:', err)
    }

  }, [initialized, activity?.content?.scorm_version])

  // Cleanup SCORM API and observers on unmount
  useEffect(() => {
    return () => {
      delete (window as any).API
      delete (window as any).API_1484_11

      // Cleanup MutationObserver and style enforcement interval
      if (iframeRef.current) {
        if ((iframeRef.current as any)._scormObserver) {
          (iframeRef.current as any)._scormObserver.disconnect()
        }
        if ((iframeRef.current as any)._scormStyleInterval) {
          clearInterval((iframeRef.current as any)._scormStyleInterval)
        }
      }
    }
  }, [])

  // Handle iframe load
  const handleIframeLoad = () => {
    setIsLoading(false)
    setError(null)

    // Inject custom styles into the iframe to improve the SCORM content appearance
    try {
      const iframe = iframeRef.current
      if (iframe?.contentDocument) {
        const style = iframe.contentDocument.createElement('style')
        style.textContent = `
          /* Full screen clean layout */
          html, body {
            margin: 0 !important;
            margin-left: 0 !important;
            margin-right: 0 !important;
            margin-top: 0 !important;
            margin-bottom: 0 !important;
            padding: 0 !important;
            border: none !important;
            outline: none !important;
            overflow: hidden !important;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif !important;
            background: #fff !important;
            height: 100% !important;
            width: 100% !important;
          }

          /* Remove all borders and padding from everything */
          * {
            border: none !important;
            outline: none !important;
            box-sizing: border-box !important;
          }

          /* Navigation - fixed at top right as floating pill buttons */
          #navDiv, .navDiv {
            position: fixed !important;
            top: 8px !important;
            right: 50px !important;
            left: auto !important;
            bottom: auto !important;
            background: transparent !important;
            padding: 0 !important;
            display: flex !important;
            flex-direction: row !important;
            justify-content: flex-end !important;
            align-items: center !important;
            gap: 8px !important;
            z-index: 9999 !important;
            border: none !important;
            box-shadow: none !important;
          }

          /* Button styling - pill buttons with text and icons */
          #navDiv input[type="button"],
          #navDiv button,
          input#butPrevious,
          input#butNext,
          #butPrevious,
          #butNext {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
            font-size: 13px !important;
            font-weight: 500 !important;
            padding: 8px 16px !important;
            border: none !important;
            border-radius: 9999px !important;
            cursor: pointer !important;
            transition: all 0.15s ease !important;
            min-width: auto !important;
            display: inline-flex !important;
            align-items: center !important;
            justify-content: center !important;
            gap: 6px !important;
            box-shadow: 0 2px 8px rgba(0,0,0,0.15) !important;
            text-indent: 0 !important;
            line-height: 1 !important;
          }

          input#butPrevious,
          #butPrevious {
            background: rgba(255,255,255,0.95) !important;
            color: #171717 !important;
          }

          input#butPrevious::before,
          #butPrevious::before {
            content: '' !important;
            display: inline-block !important;
            width: 6px !important;
            height: 6px !important;
            border-left: 2px solid #171717 !important;
            border-bottom: 2px solid #171717 !important;
            transform: rotate(45deg) !important;
            flex-shrink: 0 !important;
          }

          input#butPrevious:hover:not(:disabled),
          #butPrevious:hover:not(:disabled) {
            background: #fff !important;
            box-shadow: 0 4px 12px rgba(0,0,0,0.2) !important;
          }

          input#butNext,
          #butNext {
            background: rgba(23,23,23,0.95) !important;
            color: #fff !important;
          }

          input#butNext::after,
          #butNext::after {
            content: '' !important;
            display: inline-block !important;
            width: 6px !important;
            height: 6px !important;
            border-right: 2px solid #fff !important;
            border-top: 2px solid #fff !important;
            transform: rotate(45deg) !important;
            flex-shrink: 0 !important;
          }

          input#butNext:hover:not(:disabled),
          #butNext:hover:not(:disabled) {
            background: #171717 !important;
            box-shadow: 0 4px 12px rgba(0,0,0,0.25) !important;
          }

          input[type="button"]:disabled,
          button:disabled {
            opacity: 0.35 !important;
            cursor: not-allowed !important;
          }

          /* Hide exit button */
          #butExit, input#butExit {
            display: none !important;
          }

          /* Content iframe takes full space */
          #contentFrame {
            position: fixed !important;
            top: 0 !important;
            left: 0 !important;
            right: 0 !important;
            bottom: 0 !important;
            width: 100% !important;
            height: 100% !important;
            border: none !important;
            margin: 0 !important;
            padding: 0 !important;
          }

          /* Hide scrollbars */
          ::-webkit-scrollbar {
            display: none !important;
          }
          html, body, * {
            -ms-overflow-style: none !important;
            scrollbar-width: none !important;
          }
        `
        iframe.contentDocument.head.appendChild(style)

        // Also inject styles into nested iframes (contentFrame)
        const injectNestedStyles = () => {
          const nestedIframes = iframe.contentDocument?.querySelectorAll('iframe')
          nestedIframes?.forEach((nestedIframe: HTMLIFrameElement) => {
            try {
              if (nestedIframe.contentDocument) {
                // Force inline styles directly on body element to override any CSS
                const nestedBody = nestedIframe.contentDocument.body
                if (nestedBody) {
                  nestedBody.style.cssText = `
                    margin: 0 !important;
                    padding: 0 !important;
                    border: none !important;
                    background: #fff !important;
                    overflow-x: hidden !important;
                    overflow-y: auto !important;
                    width: 100% !important;
                    box-sizing: border-box !important;
                  `
                }

                // Also inject stylesheet for other elements
                const nestedStyle = nestedIframe.contentDocument.createElement('style')
                nestedStyle.id = 'learnhouse-scorm-styles'
                nestedStyle.textContent = `
                  html, html body, body {
                    margin: 0 !important;
                    margin-left: 0 !important;
                    margin-right: 0 !important;
                    margin-top: 0 !important;
                    margin-bottom: 0 !important;
                    padding: 0 !important;
                    border: none !important;
                    background: #fff !important;
                    overflow-x: hidden !important;
                    overflow-y: auto !important;
                    width: 100% !important;
                    box-sizing: border-box !important;
                  }
                  img {
                    max-width: 100% !important;
                    height: auto !important;
                    border: none !important;
                  }
                  ::-webkit-scrollbar {
                    width: 0 !important;
                    height: 0 !important;
                  }
                `
                // Remove any existing learnhouse styles first
                const existing = nestedIframe.contentDocument.getElementById('learnhouse-scorm-styles')
                if (existing) existing.remove()
                // Append to end of head for higher cascade priority
                nestedIframe.contentDocument.head.appendChild(nestedStyle)
              }
            } catch (e) {
              // Nested iframe might have different origin
            }
          })
        }

        // Inject immediately
        injectNestedStyles()

        // Watch for iframe loads and content changes
        const setupListeners = () => {
          iframe.contentDocument?.querySelectorAll('iframe').forEach((nestedIframe: HTMLIFrameElement) => {
            nestedIframe.removeEventListener('load', injectNestedStyles)
            nestedIframe.addEventListener('load', injectNestedStyles)
          })
        }

        setupListeners()

        // Watch for DOM changes to catch navigation
        const observer = new MutationObserver(() => {
          injectNestedStyles()
          setupListeners()
        })

        observer.observe(iframe.contentDocument.body, {
          childList: true,
          subtree: true
        })

        // Re-apply styles periodically for the first few seconds to override any late-loading CSS
        let styleEnforcementCount = 0
        const styleEnforcementInterval = setInterval(() => {
          injectNestedStyles()
          styleEnforcementCount++
          if (styleEnforcementCount >= 10) {
            clearInterval(styleEnforcementInterval)
          }
        }, 200)

        // Store observer and interval for cleanup
        ;(iframe as any)._scormObserver = observer
        ;(iframe as any)._scormStyleInterval = styleEnforcementInterval
      }
    } catch (err) {
      // Cross-origin restriction - can't inject styles
      console.log('[SCORM] Could not inject styles (cross-origin restriction)')
    }
  }

  // Handle iframe error
  const handleIframeError = () => {
    setIsLoading(false)
    setError('Failed to load SCORM content')
  }

  // Refresh content
  const refreshContent = () => {
    if (iframeRef.current) {
      setIsLoading(true)
      iframeRef.current.src = getContentUrl() || ''
    }
  }

  const contentUrl = getContentUrl()

  if (error) {
    return (
      <div className="w-full flex items-center justify-center bg-neutral-50 dark:bg-neutral-900" style={{ height: 'calc(100vh - 140px)', minHeight: '500px' }}>
        <div className="text-center space-y-5 p-8">
          <div className="w-14 h-14 mx-auto rounded-full bg-red-50 dark:bg-red-900/20 flex items-center justify-center">
            <AlertCircle size={28} className="text-red-500" />
          </div>
          <div className="space-y-2">
            <h3 className="text-base font-semibold text-neutral-900 dark:text-white">Failed to Load Content</h3>
            <p className="text-neutral-500 dark:text-neutral-400 text-sm max-w-xs">{error}</p>
          </div>
          <button
            onClick={refreshContent}
            className="inline-flex items-center gap-2 px-4 py-2 bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 rounded-lg hover:bg-neutral-800 dark:hover:bg-neutral-100 transition-colors font-medium text-sm"
          >
            <RefreshCw size={15} />
            <span>Try Again</span>
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="relative w-full bg-white dark:bg-neutral-950">
      {/* SCORM Content iframe - Full viewport */}
      {contentUrl && apiInjected && (
        <iframe
          ref={iframeRef}
          src={contentUrl}
          className="w-full block"
          style={{
            border: 'none',
            outline: 'none',
            background: 'white',
            margin: 0,
            padding: 0,
            height: 'calc(100vh - 140px)',
            minHeight: '500px',
          }}
          onLoad={handleIframeLoad}
          onError={handleIframeError}
          title={activity.content.sco_title || 'SCORM Content'}
          allow="fullscreen"
        />
      )}

      {/* Loading overlay */}
      {isLoading && apiInjected && (
        <div className="absolute inset-0 flex items-center justify-center bg-white dark:bg-neutral-950 z-10">
          <div className="text-center space-y-4">
            <div className="relative w-10 h-10 mx-auto">
              <div className="absolute inset-0 rounded-full border-2 border-neutral-200 dark:border-neutral-800"></div>
              <div className="absolute inset-0 rounded-full border-2 border-neutral-800 dark:border-white border-t-transparent animate-spin"></div>
            </div>
            <p className="text-sm text-neutral-500 dark:text-neutral-400">Loading content...</p>
          </div>
        </div>
      )}

      {/* Initializing state */}
      {!apiInjected && !error && (
        <div className="flex items-center justify-center bg-neutral-50 dark:bg-neutral-900" style={{ height: 'calc(100vh - 140px)', minHeight: '500px' }}>
          <div className="text-center space-y-4">
            <div className="relative w-10 h-10 mx-auto">
              <div className="absolute inset-0 rounded-full border-2 border-neutral-200 dark:border-neutral-800"></div>
              <div className="absolute inset-0 rounded-full border-2 border-neutral-800 dark:border-white border-t-transparent animate-spin"></div>
            </div>
            <div className="space-y-1">
              <p className="text-sm text-neutral-700 dark:text-white font-medium">Preparing your content</p>
              <p className="text-xs text-neutral-400">Initializing session...</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default ScormActivity
