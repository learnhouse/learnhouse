'use client'
// Streaming generation for the Magic block: start a session or iterate on
// one, stream the HTML into local state, cancel, and turn every way a stream
// can end (done, error event, HTTP error, dropped connection, abort) into one
// result. Nothing here touches the document: the block writes attrs only
// when the author accepts a result.
import React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { iterateMagicBlock, startMagicBlockSession } from '@services/ai/magicblocks'
import { apiFetch } from '@services/utils/ts/requests'
import { getAPIUrl } from '@services/config/config'
import { extractHtmlDocument } from './extractHtml'
import type { MagicBlockContext } from './types'
import { MAGIC_CREDIT_COST, classifyMagicError, type MagicError } from './magicModel'

export { MAGIC_CREDIT_COST, type MagicError } from './magicModel'

export type MagicRequest =
  | { kind: 'start'; prompt: string }
  | { kind: 'iterate'; prompt: string; sessionUuid: string; baseHtml: string | null }

export interface MagicResult {
  html: string
  sessionUuid: string
  prompt: string
}

export function useMagicGeneration(opts: {
  activityUuid: string
  blockUuid: string
  accessToken?: string
  context: () => MagicBlockContext
  styleReference: string | null
}) {
  const [streaming, setStreaming] = React.useState(false)
  const [stream, setStream] = React.useState('')
  const [error, setError] = React.useState<MagicError | null>(null)
  const [last, setLast] = React.useState<MagicRequest | null>(null)
  // Credits the last finished generation used (ai-credits).
  const [creditsUsed, setCreditsUsed] = React.useState<number | null>(null)
  const abortRef = React.useRef<AbortController | null>(null)
  const optsRef = React.useRef(opts)
  React.useEffect(() => {
    optsRef.current = opts
  })

  // Stop a running stream if the block goes away.
  React.useEffect(() => () => abortRef.current?.abort(), [])

  const run = React.useCallback(async (req: MagicRequest): Promise<MagicResult | null> => {
    const o = optsRef.current
    if (!o.accessToken) return null
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setLast(req)
    setError(null)
    setStream('')
    setStreaming(true)

    let text = ''
    let session: string | null = null
    let failure: string | null = null
    const onChunk = (chunk: string) => {
      text += chunk
      setStream(text)
    }
    const onComplete = (uuid: string, credits?: number | null) => {
      session = uuid
      if (typeof credits === 'number') setCreditsUsed(credits)
    }
    const onError = (msg: string) => {
      failure = msg
    }
    try {
      if (req.kind === 'start') {
        await startMagicBlockSession(o.activityUuid, o.blockUuid, req.prompt, o.context(), o.accessToken, onChunk, onComplete, onError, o.styleReference, controller.signal)
      } else {
        await iterateMagicBlock(req.sessionUuid, o.activityUuid, o.blockUuid, req.prompt, o.accessToken, onChunk, onComplete, onError, req.baseHtml, o.styleReference, controller.signal)
      }
    } catch (e) {
      failure = e instanceof Error ? e.message : String(e)
    }
    if (abortRef.current === controller) abortRef.current = null
    setStreaming(false)
    if (controller.signal.aborted) {
      setStream('')
      return null
    }
    const html = extractHtmlDocument(text) || text
    if (failure || !session || !html.trim()) {
      // A stream that closes without "done" (dropped connection, proxy
      // timeout) used to leave the old modal spinning forever.
      setError(classifyMagicError(failure ?? 'stopped: the generation ended before it finished'))
      setStream('')
      return null
    }
    setStream('')
    return { html, sessionUuid: session, prompt: req.prompt }
  }, [])

  const cancel = React.useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setStreaming(false)
    setStream('')
  }, [])

  return { run, cancel, streaming, stream, error, setError, last, creditsUsed }
}

interface AICreditsSummary {
  total_credits: number | string
  used_credits: number
  remaining_credits: number | string
}

/** The org's AI credit balance (same query as the dashboard usage card). */
export function useAICredits(orgId: number | undefined, accessToken: string | undefined, cost: number = MAGIC_CREDIT_COST) {
  const client = useQueryClient()
  const key = React.useMemo(() => ['org', orgId, 'ai-credits'], [orgId])
  const { data } = useQuery<AICreditsSummary>({
    queryKey: key,
    queryFn: () => apiFetch(`${getAPIUrl()}orgs/${orgId}/ai-credits`, accessToken as string),
    enabled: !!orgId && !!accessToken,
    staleTime: 30_000,
    retry: false,
  })
  const unlimited = data?.remaining_credits === 'unlimited' || data?.total_credits === 'unlimited'
  const remaining = typeof data?.remaining_credits === 'number' ? data.remaining_credits : null
  return {
    loaded: !!data,
    unlimited,
    remaining,
    cost,
    enough: unlimited || remaining === null || remaining >= cost,
    refresh: () => client.invalidateQueries({ queryKey: key }),
  }
}
