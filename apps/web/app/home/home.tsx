'use client'

import React, { useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, BookOpen, LogOut, Plus, Settings } from 'lucide-react'

import { useLHSession } from '@components/Contexts/LHSessionContext'
import { canManageOrgFromSession } from '@components/Hooks/useAdminStatus'
import UserAvatar from '@components/Objects/UserAvatar'
import { signOut } from '@components/Contexts/AuthContext'
import { getAPIUrl, getUriWithOrg } from '@services/config/config'
import { apiFetch } from '@services/utils/ts/requests'
import { getOrgLogoMediaDirectory } from '@services/media/media'

const RED = '#C51635'
const NAVY = '#0B263D'

function LearningSpaceCard({ org }: { org: any }) {
  const session = useLHSession() as any
  const canManage = canManageOrgFromSession(session, org?.id)
  const initial = (org?.name || org?.slug || 'A').trim().charAt(0).toUpperCase()

  return (
    <article className="group overflow-hidden rounded-[24px] border border-black/[0.08] bg-white shadow-[0_14px_45px_rgba(11,38,61,0.06)] transition hover:-translate-y-0.5 hover:shadow-[0_18px_55px_rgba(11,38,61,0.1)]">
      <div className="flex items-center gap-4 p-5 sm:p-6">
        {org?.logo_image ? (
          <img
            src={getOrgLogoMediaDirectory(org.org_uuid, org.logo_image)}
            alt=""
            className="h-14 w-14 shrink-0 rounded-2xl border border-black/[0.06] object-cover"
          />
        ) : (
          <div
            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-xl font-black text-white"
            style={{ backgroundColor: NAVY }}
          >
            {initial}
          </div>
        )}

        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-black uppercase tracking-[0.18em]" style={{ color: RED }}>
            Learning space
          </p>
          <h2 className="mt-1 truncate text-lg font-black tracking-[-0.02em] text-[#101418] sm:text-xl">
            {org?.name || 'Acyberschool'}
          </h2>
          {org?.description && (
            <p className="mt-1 line-clamp-1 text-sm text-black/45">{org.description}</p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 border-t border-black/[0.06] bg-[#FAFAFA] p-3 sm:px-5">
        <Link
          href={getUriWithOrg(org.slug, '/')}
          className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-extrabold text-white"
          style={{ backgroundColor: RED }}
        >
          Enter learning
          <ArrowRight className="h-4 w-4" />
        </Link>
        {canManage && (
          <Link
            href={getUriWithOrg(org.slug, '/dash')}
            aria-label={`Manage ${org?.name || 'learning space'}`}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-black/10 bg-white text-[#0B263D] hover:bg-black/[0.03]"
          >
            <Settings className="h-4 w-4" />
          </Link>
        )}
      </div>
    </article>
  )
}

export default function HomeClient() {
  const session = useLHSession() as any
  const router = useRouter()
  const accessToken = session?.data?.tokens?.access_token
  const isAuthenticated = session?.status === 'authenticated'
  const isLoading = session?.status === 'loading'
  const firstName = session?.data?.user?.first_name || ''

  const { data: orgs, isLoading: orgsLoading } = useQuery({
    queryKey: ['orgs', 'user'],
    queryFn: () => apiFetch(`${getAPIUrl()}orgs/user/page/1/limit/50`, accessToken),
    enabled: isAuthenticated && !!accessToken,
    staleTime: 60_000,
  })

  useEffect(() => {
    if (!isLoading && !isAuthenticated) router.replace('/login')
  }, [isLoading, isAuthenticated, router])

  useEffect(() => {
    if (isAuthenticated && Array.isArray(orgs) && orgs.length === 0) router.replace('/new')
  }, [isAuthenticated, orgs, router])

  if (isLoading || (isAuthenticated && orgsLoading)) {
    return (
      <main className="min-h-screen bg-white px-5 py-12 sm:px-8">
        <div className="mx-auto max-w-5xl animate-pulse">
          <div className="h-4 w-32 rounded bg-black/[0.06]" />
          <div className="mt-6 h-16 max-w-3xl rounded-2xl bg-black/[0.05]" />
          <div className="mt-12 grid gap-4 md:grid-cols-2">
            <div className="h-40 rounded-[24px] bg-black/[0.04]" />
            <div className="h-40 rounded-[24px] bg-black/[0.04]" />
          </div>
        </div>
      </main>
    )
  }

  if (!isAuthenticated) return null

  return (
    <main className="min-h-screen bg-white text-[#101418]">
      <header className="border-b border-black/[0.06]">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4 sm:px-8">
          <Link href="/home" className="flex items-center gap-3" aria-label="Acyberschool home">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl text-white" style={{ backgroundColor: NAVY }}>
              <BookOpen className="h-4 w-4" />
            </span>
            <span className="text-base font-black tracking-[-0.03em]">Acyberschool</span>
          </Link>

          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-xs font-bold text-[#101418]">{firstName || 'Learner'}</p>
              <p className="text-[10px] text-black/40">Learning that moves into work</p>
            </div>
            <UserAvatar border="border" rounded="rounded-full" width={36} />
            <button
              type="button"
              onClick={() => signOut({ redirect: true, callbackUrl: '/login' })}
              className="flex h-9 w-9 items-center justify-center rounded-full text-black/40 hover:bg-black/[0.04] hover:text-black/70"
              aria-label="Sign out"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      <section className="relative overflow-hidden border-b border-black/[0.06]">
        <div className="absolute right-0 top-0 hidden h-full w-[34%] lg:block" style={{ backgroundColor: NAVY }} />
        <div className="relative mx-auto grid max-w-6xl gap-10 px-5 py-12 sm:px-8 sm:py-16 lg:grid-cols-[1fr_0.42fr] lg:py-20">
          <div>
            <div className="mb-6 flex items-center gap-3">
              <span className="h-[3px] w-10 rounded-full" style={{ backgroundColor: RED }} />
              <span className="text-[10px] font-black uppercase tracking-[0.2em]" style={{ color: RED }}>
                Acyberschool learning
              </span>
            </div>
            {firstName && <p className="mb-3 text-sm font-semibold text-black/45">Welcome back, {firstName}.</p>}
            <h1 className="max-w-4xl text-[38px] font-black leading-[1.03] tracking-[-0.055em] sm:text-5xl lg:text-[62px]">
              Learning should change what you are capable of applying at work, <span style={{ color: RED }}>from day 1.</span>
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-black/55 sm:text-lg">
              Enter your learning space. Learn the concept, use it in your work and keep a record of what changed.
            </p>
          </div>

          <div className="rounded-[24px] p-6 text-white lg:self-end lg:bg-transparent" style={{ backgroundColor: NAVY }}>
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-[#FF8A9E]">The Acyberschool method</p>
            <p className="mt-3 text-xl font-black leading-tight">Learn. Apply. Measure.</p>
            <p className="mt-2 text-sm leading-6 text-white/65">Your learning portfolio grows as your work changes.</p>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-10 sm:px-8 sm:py-14">
        <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.18em]" style={{ color: RED }}>Continue</p>
            <h2 className="mt-1 text-2xl font-black tracking-[-0.03em] sm:text-3xl">Enter your learning</h2>
          </div>
          <p className="text-sm text-black/40">{Array.isArray(orgs) ? orgs.length : 0} learning {Array.isArray(orgs) && orgs.length === 1 ? 'space' : 'spaces'}</p>
        </div>

        {Array.isArray(orgs) && orgs.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2">
            {orgs.map((org: any) => <LearningSpaceCard key={org.id ?? org.slug} org={org} />)}
          </div>
        ) : (
          <div className="rounded-[24px] border border-dashed border-black/15 bg-[#FAFAFA] px-5 py-12 text-center">
            <BookOpen className="mx-auto h-8 w-8 text-black/20" />
            <p className="mt-3 font-black">Your learning space is being prepared.</p>
          </div>
        )}

        <div className="mt-8 flex items-center justify-between border-t border-black/[0.06] pt-6">
          <p className="text-xs text-black/35">Acyberschool · Applied learning for work</p>
          <Link href="/new" className="inline-flex items-center gap-1.5 text-xs font-bold text-black/40 hover:text-black/65">
            <Plus className="h-3.5 w-3.5" />
            Create learning space
          </Link>
        </div>
      </section>
    </main>
  )
}
