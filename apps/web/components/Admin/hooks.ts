'use client'
import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { getMe, errorStatus, isNotAvailable } from '@services/ee/platform/api'
import { platformKeys } from '@services/ee/platform/keys'
import { ALL_PERMISSIONS, type PlatformPermission, type PlatformRole } from '@services/ee/platform/types'

export function useAccessToken(): string | undefined {
  const session = useLHSession() as any
  return session?.data?.tokens?.access_token
}

/**
 * Retry policy for console queries: a 4xx (missing endpoint, no permission)
 * will not change on retry, so only transient failures get one more try.
 */
export function shouldRetry(failureCount: number, err: unknown): boolean {
  const s = errorStatus(err)
  if (s && s >= 400 && s < 500) return false
  if (s === 503) return false
  return failureCount < 1
}

export interface PlatformIdentity {
  userId?: number
  username?: string
  email?: string
  avatarImage?: string | null
  userUuid?: string
  role: PlatformRole | string
  permissions: Set<PlatformPermission>
  /** /me is not on this server yet: every superadmin is an owner (pre-roles behaviour). */
  legacy: boolean
  isLoading: boolean
  can: (_perm: PlatformPermission) => boolean
  canAny: (..._perms: PlatformPermission[]) => boolean
}

/**
 * The signed-in platform team member and their permissions (GET /me).
 * Hiding a button is only a courtesy: the API enforces every permission.
 */
export function usePlatformMe(): PlatformIdentity {
  const token = useAccessToken()
  const session = useLHSession() as any
  const user = session?.data?.user
  const q = useQuery({
    queryKey: platformKeys.me(),
    queryFn: () => getMe(token),
    enabled: !!token,
    retry: shouldRetry,
    staleTime: 5 * 60_000,
  })

  return React.useMemo(() => {
    let role: string = 'viewer'
    let perms: PlatformPermission[] = []
    let legacy = false
    if (q.data) {
      role = q.data.role || 'viewer'
      perms = Array.isArray(q.data.permissions) ? q.data.permissions : []
    } else if (q.error && isNotAvailable(q.error) && user?.is_superadmin) {
      // Older API without roles: no row means owner, so behave as before.
      legacy = true
      role = 'owner'
      perms = ALL_PERMISSIONS
    } else if (q.error && errorStatus(q.error) !== 403 && user?.is_superadmin) {
      // /me failed for another reason: read-only until it answers.
      perms = ['platform.read']
    }
    const set = new Set(perms)
    return {
      userId: q.data?.user_id ?? user?.id,
      username: q.data?.username ?? user?.username,
      email: q.data?.email ?? user?.email,
      avatarImage: q.data?.avatar_image ?? user?.avatar_image ?? null,
      userUuid: q.data?.user_uuid ?? user?.user_uuid,
      role,
      permissions: set,
      legacy,
      isLoading: q.isLoading,
      can: (p: PlatformPermission) => set.has(p),
      canAny: (...ps: PlatformPermission[]) => ps.some((p) => set.has(p)),
    }
  }, [q.data, q.error, q.isLoading, user])
}

/**
 * Filters kept in the URL (so a filtered list can be shared or bookmarked).
 * Defaults are dropped from the URL to keep links short.
 */
export function useUrlFilters<T extends Record<string, string>>(defaults: T) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const values = React.useMemo(() => {
    const out = { ...defaults }
    for (const key of Object.keys(defaults)) {
      const v = searchParams?.get(key)
      if (v !== null && v !== undefined) (out as Record<string, string>)[key] = v
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  const set = React.useCallback(
    (updates: Partial<T>) => {
      const params = new URLSearchParams(searchParams?.toString() ?? '')
      for (const [key, value] of Object.entries(updates)) {
        if (value === undefined || value === '' || value === defaults[key]) params.delete(key)
        else params.set(key, String(value))
      }
      const qs = params.toString()
      router.replace(`${pathname}${qs ? `?${qs}` : ''}`, { scroll: false })
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [searchParams, router, pathname]
  )
  return [values, set] as const
}

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = React.useState(value)
  React.useEffect(() => {
    const id = setTimeout(() => setV(value), ms)
    return () => clearTimeout(id)
  }, [value, ms])
  return v
}

export function useFrontendDomain(): string {
  const [domain, setDomain] = React.useState('localhost:3000')
  React.useEffect(() => {
    const d = document.cookie
      .split('; ')
      .find((c) => c.startsWith('LH_frontend_domain='))
      ?.split('=')[1]
    // The cookie value is URL-encoded (localhost%3A3000).
    if (d) setDomain(decodeURIComponent(d))
  }, [])
  return domain
}

/**
 * Every query param as a record, plus a setter that drops empty values. The
 * FilterBar's state: filters live in the URL so a filtered list is a link.
 */
export function useUrlQuery() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const values = React.useMemo(() => {
    const out: Record<string, string | undefined> = {}
    searchParams?.forEach((v, k) => {
      out[k] = v
    })
    return out
  }, [searchParams])
  const set = React.useCallback(
    // Discrete changes (a filter, a chip, a page, opening a drawer) push a
    // history entry so Back/Forward walks through view states; typing in a
    // search box passes `replace` so each keystroke doesn't add one.
    (updates: Record<string, string | undefined>, opts?: { replace?: boolean }) => {
      const params = new URLSearchParams(searchParams?.toString() ?? '')
      for (const [key, value] of Object.entries(updates)) {
        if (value === undefined || value === '') params.delete(key)
        else params.set(key, value)
      }
      const qs = params.toString()
      const href = `${pathname}${qs ? `?${qs}` : ''}`
      if (qs === (searchParams?.toString() ?? '')) return
      if (opts?.replace) router.replace(href, { scroll: false })
      else router.push(href, { scroll: false })
    },
    [searchParams, router, pathname]
  )
  return [values, set] as const
}

/**
 * j/k to move through a list, Enter to open the highlighted row. Ignored
 * while typing, with a modifier held, or when a dialog is open. Rows opt in
 * with `rowProps(i)` (adds data-kb-row / data-active for styling:
 * `data-[active=true]:bg-neutral-50`).
 */
export function useListKeyboard<T>(items: T[], onOpen: (item: T) => void) {
  const [active, setActive] = React.useState(-1)
  const activeRef = React.useRef(-1)
  activeRef.current = active
  const itemsRef = React.useRef(items)
  const openRef = React.useRef(onOpen)
  itemsRef.current = items
  openRef.current = onOpen

  React.useEffect(() => {
    setActive(-1)
  }, [items.length])

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const target = e.target as HTMLElement | null
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return
      if (document.querySelector('[role="dialog"]')) return
      const n = itemsRef.current.length
      if (!n) return
      if (e.key === 'j' || e.key === 'k') {
        e.preventDefault()
        setActive((cur) => {
          const next = e.key === 'j' ? Math.min(n - 1, cur + 1) : Math.max(0, cur < 0 ? 0 : cur - 1)
          requestAnimationFrame(() => document.querySelector(`[data-kb-row="${next}"]`)?.scrollIntoView({ block: 'nearest' }))
          return next
        })
      } else if (e.key === 'Enter') {
        // Read the highlight from a ref: opening navigates, which must not
        // happen inside a state updater (React warns, and StrictMode would
        // run it twice).
        const cur = activeRef.current
        if (cur >= 0 && cur < n) {
          e.preventDefault()
          openRef.current(itemsRef.current[cur])
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const rowProps = (i: number) => ({ 'data-kb-row': i, 'data-active': i === active ? 'true' : undefined })
  return { activeIndex: active, setActiveIndex: setActive, rowProps }
}
