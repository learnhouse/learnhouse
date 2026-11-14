'use client'
import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { useLHSession } from '@components/Contexts/LHSessionContext'

/**
 * Many query keys are not scoped by user (the trail, a course's meta with the
 * viewer's progress, "my" assignments...), and the router keeps prefetched
 * pages in memory. Sign-in and sign-out normally do a full page load, which
 * starts both caches from scratch, but a session can also end or change in
 * place: an expired refresh token, a logout broadcast from another tab, a
 * sign-in that completes without a reload. When the signed-in user changes,
 * drop everything cached for the previous one so nothing leaks across users.
 */
export default function QueryCacheUserGuard() {
  const session = useLHSession() as any
  const queryClient = useQueryClient()
  const router = useRouter()
  const status: string | undefined = session?.status
  // 'anon' for signed out; the user's id once signed in. Unknown while loading.
  const identity =
    status === 'authenticated'
      ? String(session?.data?.user?.id ?? session?.data?.user?.user_uuid ?? 'user')
      : status === 'unauthenticated'
        ? 'anon'
        : null
  const previous = useRef<string | null>(null)

  useEffect(() => {
    if (identity === null) return
    if (previous.current !== null && previous.current !== identity) {
      queryClient.clear()
      router.refresh()
    }
    previous.current = identity
  }, [identity, queryClient, router])

  return null
}
