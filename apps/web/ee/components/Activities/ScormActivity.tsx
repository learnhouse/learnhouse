import React, { useEffect, useRef, useState, useCallback } from 'react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { getAPIUrl } from '@services/config/config'
import { getScormContentUrl } from '@services/media/media'
import { RefreshCw, AlertCircle } from 'lucide-react'
import { ScormRuntimeAPI, requestScormLaunch } from '../../services/scorm/ScormRuntimeAPI'
import { SCORM_IFRAME_SANDBOX, handleShimMessage } from '../../services/scorm/scormShim'

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

function ScormActivity({ activity }: ScormActivityProps) {
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token

  const iframeRef = useRef<HTMLIFrameElement>(null)
  const runtimeRef = useRef<ScormRuntimeAPI | null>(null)
  const initStartedRef = useRef(false)

  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [initialized, setInitialized] = useState(false)
  const [launchToken, setLaunchToken] = useState<string | null>(null)
  const [launchAttempt, setLaunchAttempt] = useState(0)
  const [needsAuth, setNeedsAuth] = useState(false)
  const [saveError, setSaveError] = useState(false)
  const [resuming, setResuming] = useState(false)

  // Auto-dismiss the "resuming" indicator after a few seconds.
  useEffect(() => {
    if (!resuming) return
    const t = window.setTimeout(() => setResuming(false), 4000)
    return () => window.clearTimeout(t)
  }, [resuming])

  // The package is served sandboxed under a launch token; its relative URLs
  // resolve under the same prefix.
  const getContentUrl = useCallback(() => {
    if (!launchToken || !activity?.activity_uuid) return null
    return getScormContentUrl(activity.activity_uuid, launchToken, activity.content.entry_point)
  }, [launchToken, activity?.activity_uuid, activity?.content?.entry_point])

  // Initialize SCORM runtime
  useEffect(() => {
    if (!activity?.activity_uuid || initStartedRef.current) return
    // SCORM tracking requires an authenticated session. Without a token, show a
    // clear sign-in prompt instead of an endless "Initializing…" spinner.
    if (!access_token) {
      setNeedsAuth(true)
      return
    }
    setNeedsAuth(false)
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

        // Surface save failures to the learner so silent data loss is visible.
        runtime.setSaveStatusHandler((ok: boolean) => setSaveError(!ok))

        // Initialize the session
        const success = await runtime.initialize()
        if (!success) {
          throw new Error('Runtime initialization returned false')
        }

        runtimeRef.current = runtime
        setResuming(runtime.isResuming())

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

  // Mint the launch token once the runtime is ready, so the content's seeded
  // CMI matches what the runtime just initialized.
  useEffect(() => {
    if (!initialized || launchToken || !activity?.activity_uuid) return
    let cancelled = false
    requestScormLaunch(getAPIUrl(), activity.activity_uuid, access_token)
      .then(({ token }) => {
        if (!cancelled) setLaunchToken(token)
      })
      .catch((err) => {
        console.error('Failed to launch SCORM content:', err)
        if (!cancelled) setError('Failed to load SCORM content')
      })
    return () => {
      cancelled = true
    }
  }, [initialized, launchToken, launchAttempt, access_token, activity?.activity_uuid])

  // The package runs in an opaque origin and cannot reach this window's API.
  // The shim injected into its documents answers SCORM calls from its own
  // cache and reports writes here; only messages from our iframe count.
  useEffect(() => {
    if (!initialized) return
    const onMessage = (event: MessageEvent) => {
      const frame = iframeRef.current
      if (!frame || !frame.contentWindow || event.source !== frame.contentWindow) return
      const reply = handleShimMessage(runtimeRef.current, event.data)
      if (reply) frame.contentWindow.postMessage(reply, '*')
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [initialized])

  // Layout CSS is applied by the shim inside the (cross-origin) frame.
  const handleIframeLoad = () => {
    setIsLoading(false)
    setError(null)
  }

  // Handle iframe error
  const handleIframeError = () => {
    setIsLoading(false)
    setError('Failed to load SCORM content')
  }

  // Refresh content
  const refreshContent = () => {
    setError(null)
    if (!launchToken) {
      setLaunchAttempt((n) => n + 1)
      return
    }
    if (iframeRef.current) {
      setIsLoading(true)
      iframeRef.current.src = getContentUrl() || ''
    }
  }

  const contentUrl = getContentUrl()

  if (needsAuth) {
    return (
      <div
        className="w-full flex items-center justify-center bg-neutral-50 dark:bg-neutral-900"
        style={{ height: 'calc(100vh - 140px)', minHeight: '500px' }}
        role="status"
      >
        <div className="text-center space-y-4 p-8 max-w-sm">
          <div className="w-14 h-14 mx-auto rounded-full bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center">
            <AlertCircle size={28} className="text-neutral-500" />
          </div>
          <div className="space-y-2">
            <h3 className="text-base font-semibold text-neutral-900 dark:text-white">Sign in to start</h3>
            <p className="text-neutral-500 dark:text-neutral-400 text-sm">
              This SCORM activity tracks your progress, so you need to be signed in to launch it.
            </p>
          </div>
        </div>
      </div>
    )
  }

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
      {/* Save-failure warning; makes silent progress loss visible */}
      {saveError && (
        <div
          role="alert"
          className="absolute top-3 left-1/2 -translate-x-1/2 z-20 px-3 py-1.5 rounded-full bg-amber-500 text-white text-xs font-medium shadow-lg flex items-center gap-1.5"
        >
          <AlertCircle size={13} />
          <span>Progress isn’t saving. Check your connection. We’ll keep retrying.</span>
        </div>
      )}

      {/* Resume indicator */}
      {resuming && !saveError && (
        <div
          role="status"
          className="absolute top-3 end-3 z-20 px-3 py-1.5 rounded-full bg-neutral-900/90 text-white text-xs font-medium shadow-lg"
        >
          Resuming where you left off
        </div>
      )}

      {/* SCORM Content iframe - Full viewport */}
      {contentUrl && (
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
          sandbox={SCORM_IFRAME_SANDBOX}
          referrerPolicy="no-referrer"
          allow="fullscreen"
        />
      )}

      {/* Loading overlay */}
      {isLoading && contentUrl && (
        <div role="status" aria-live="polite" className="absolute inset-0 flex items-center justify-center bg-white dark:bg-neutral-950 z-10">
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
      {!contentUrl && !error && (
        <div role="status" aria-live="polite" className="flex items-center justify-center bg-neutral-50 dark:bg-neutral-900" style={{ height: 'calc(100vh - 140px)', minHeight: '500px' }}>
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
