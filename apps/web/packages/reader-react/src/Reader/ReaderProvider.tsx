'use client'

import { createContext, useContext, useMemo, type ReactNode } from 'react'

export interface ReaderConfig {
  baseApiUrl: string
  orgSlug: string
  accessToken?: string
  /**
   * Optional. Organization UUID. Required for resolving media-block URLs
   * (image / video / audio / PDF blocks). If omitted, those blocks render
   * a fallback message instead of the actual media.
   */
  orgUuid?: string
  /**
   * Optional. Base URL for media/streaming endpoints. Defaults to
   * `baseApiUrl`. Set when your media is served from a different host
   * (e.g. a CDN or dedicated media server).
   */
  mediaBaseUrl?: string
  /** Show the "Powered by LearnHouse" badge (default: true). */
  showPoweredBy?: boolean
  /**
   * Optional. Builds the canonical activity URL used by the "Powered by"
   * badge link and the unsupported-activity fallback. Defaults to a path
   * like `/course/{uuid}/activity/{id}` if not provided.
   */
  buildActivityUrl?: (input: { orgSlug: string; courseUuid: string; activityId: string }) => string
}

const ReaderContext = createContext<ReaderConfig | null>(null)

export interface LearnHouseReaderProviderProps extends ReaderConfig {
  children: ReactNode
}

export function LearnHouseReaderProvider({
  children,
  baseApiUrl,
  orgSlug,
  orgUuid,
  mediaBaseUrl,
  accessToken,
  showPoweredBy,
  buildActivityUrl,
}: LearnHouseReaderProviderProps) {
  const value = useMemo<ReaderConfig>(
    () => ({
      baseApiUrl,
      orgSlug,
      orgUuid,
      mediaBaseUrl,
      accessToken,
      showPoweredBy: showPoweredBy ?? true,
      buildActivityUrl,
    }),
    [baseApiUrl, orgSlug, orgUuid, mediaBaseUrl, accessToken, showPoweredBy, buildActivityUrl],
  )

  return <ReaderContext.Provider value={value}>{children}</ReaderContext.Provider>
}

export function useReaderConfig(): ReaderConfig {
  const ctx = useContext(ReaderContext)
  if (!ctx) {
    throw new Error(
      '`useReaderConfig` must be used inside <LearnHouseReaderProvider>.',
    )
  }
  return ctx
}
