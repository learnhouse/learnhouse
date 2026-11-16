'use client'
import React, { use } from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { Eye, LockSimple, Megaphone, PushPin, ShieldCheck, Sparkle, Users } from '@phosphor-icons/react'
import GeneralWrapperStyled from '@components/Objects/StyledElements/Wrappers/GeneralWrapper'
import { formatRelative } from '@components/Dashboard/Shared/DashKit/DashKit'
import { getUriWithOrg } from '@services/config/config'
import { getCourseThumbnailMediaDirectory } from '@services/media/media'
import { personName, useUG } from '@components/Dashboard/Pages/Users/OrgUserGroups/groupsApi'
import { Avatar, GroupTile } from '@components/Dashboard/Pages/Users/OrgUserGroups/ugUi'
import { KindTile } from '@components/Dashboard/Pages/Users/OrgUserGroups/tabs/AccessTab'

function SectionTitle({ icon, title, count }: { icon: React.ReactNode; title: string; count?: number }) {
  return (
    <div className="flex items-center gap-2.5 my-4">
      <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-white nice-shadow text-black">{icon}</div>
      <h2 className="text-xl font-bold text-gray-900 tracking-tight">{title}</h2>
      {count !== undefined && <span className="text-sm text-gray-400 tabular-nums">{count}</span>}
    </div>
  )
}

const PATHS: Record<string, (_id: string) => string> = {
  course: (id) => `/course/${id.replace('course_', '')}`,
  path: (id) => `/path/${id.replace('path_', '')}`,
  community: (id) => `/community/${id.replace('community_', '')}`,
  podcast: (id) => `/podcast/${id.replace('podcast_', '')}`,
  live_session: (id) => `/live/${id}`,
  folder: (id) => `/library/folder/${id.replace('folder_', '')}`,
}

export default function GroupSpacePage(props: { params: Promise<{ orgslug: string; groupid: string }> }) {
  const { orgslug, groupid } = use(props.params)
  const { t, i18n } = useTranslation()
  const { call, orgId, ready, org } = useUG()
  const { data, isLoading, error } = useQuery({
    queryKey: ['usergroups', 'v2', orgId, 'space', groupid],
    queryFn: () => call<any>('GET', `org/${orgId}/space/${groupid}`),
    enabled: ready,
    retry: false,
  })

  if (!ready || isLoading) {
    return (
      <GeneralWrapperStyled>
        <div className="animate-pulse space-y-4 pt-6">
          <div className="h-8 w-64 rounded bg-gray-200" />
          <div className="h-4 w-96 max-w-full rounded bg-gray-200" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-24 rounded-2xl bg-gray-200" />
            ))}
          </div>
        </div>
      </GeneralWrapperStyled>
    )
  }
  if (error || !data) {
    return (
      <GeneralWrapperStyled>
        <div className="flex flex-col justify-center items-center py-16 px-4 border-2 border-dashed border-gray-100 rounded-2xl bg-gray-50/30 mt-6">
          <div className="p-4 bg-white rounded-full nice-shadow mb-4 text-gray-300">
            <LockSimple size={28} />
          </div>
          <h3 className="text-xl font-bold text-gray-600 mb-2 text-center">{t('groups.space.not_found')}</h3>
          <p className="text-md text-gray-400 text-center max-w-xs">{t('groups.space.not_found_desc')}</p>
        </div>
      </GeneralWrapperStyled>
    )
  }

  const g = data.group
  const content: any[] = data.content ?? []
  const announcements: any[] = data.announcements ?? []
  return (
    <GeneralWrapperStyled>
      <div className="flex flex-col gap-2 pt-2">
        {data.preview && (
          <div className="flex items-center gap-2 self-start rounded-full bg-amber-50 ring-1 ring-inset ring-amber-600/10 px-3 py-1 text-xs font-semibold text-amber-800">
            <Eye size={13} /> {t('groups.space.preview')}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-4 py-4">
          <GroupTile color={g.color} kind="manual" size={56} />
          <div className="min-w-0 flex-1">
            <h1 className="text-3xl font-bold tracking-tight text-gray-900" dir="auto" data-testid="space-title">
              {g.name}
            </h1>
            {g.description && <p className="mt-1 text-gray-500 max-w-2xl" dir="auto">{g.description}</p>}
            <p className="mt-1.5 text-sm text-gray-400">{t('groups.space.member_count', { count: data.member_count })}</p>
          </div>
          {data.capabilities?.role !== 'none' && (
            <Link
              href={getUriWithOrg(orgslug, data.capabilities?.admin ? `/dash/users/settings/usergroups?group=${g.id}` : `/groups?group=${g.id}`)}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-white nice-shadow text-sm font-semibold text-gray-800 hover:bg-gray-50"
            >
              <ShieldCheck size={14} className="text-emerald-600" /> {t('groups.space.manage')}
            </Link>
          )}
        </div>

        {announcements.length > 0 && (
          <section>
            <SectionTitle icon={<Megaphone size={16} />} title={t('groups.space.announcements')} />
            <ul className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {announcements.map((a) => (
                <li key={a.announcement_uuid} className="bg-white rounded-2xl nice-shadow p-5">
                  <div className="flex items-center gap-2 mb-2">
                    {a.author && <Avatar person={a.author} size={24} />}
                    <span className="text-sm font-semibold text-gray-800">{personName(a.author) || org?.name}</span>
                    <span className="text-xs text-gray-400">{formatRelative(a.created_at, i18n.language)}</span>
                    {a.pinned && <PushPin size={14} weight="fill" className="ms-auto text-amber-500" />}
                  </div>
                  <h3 className="text-base font-bold text-gray-900" dir="auto">{a.title}</h3>
                  {a.body && <p className="mt-1 text-sm text-gray-600 whitespace-pre-line" dir="auto">{a.body}</p>}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <SectionTitle icon={<Sparkle size={16} />} title={t('groups.space.content')} count={content.length} />
          {content.length === 0 ? (
            <div className="flex flex-col justify-center items-center py-12 px-4 border-2 border-dashed border-gray-100 rounded-2xl bg-gray-50/30">
              <p className="text-md text-gray-400 text-center">{t('groups.space.no_content')}</p>
            </div>
          ) : (
            <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {content.map((c) => {
                const href = PATHS[c.kind] ? getUriWithOrg(orgslug, PATHS[c.kind](c.resource_uuid)) : null
                const thumb = c.kind === 'course' && c.thumbnail_image && org?.org_uuid
                  ? getCourseThumbnailMediaDirectory(org.org_uuid, c.resource_uuid, c.thumbnail_image)
                  : null
                const card = (
                  <div className="bg-white rounded-2xl nice-shadow overflow-hidden h-full hover:shadow-md transition-shadow">
                    {thumb ? (
                      <img src={thumb} alt="" className="w-full h-32 object-cover bg-gray-100" />
                    ) : (
                      <div className="h-20 bg-gray-50 flex items-center justify-center">
                        <KindTile kind={c.kind} />
                      </div>
                    )}
                    <div className="p-4">
                      <p className="text-xs font-medium text-gray-400">{t(`groups.access.kinds.${c.kind}`, { defaultValue: c.kind })}</p>
                      <p className="mt-0.5 text-sm font-bold text-gray-900 line-clamp-2" dir="auto">{c.name}</p>
                    </div>
                  </div>
                )
                return <li key={c.resource_uuid}>{href ? <Link href={href}>{card}</Link> : card}</li>
              })}
            </ul>
          )}
        </section>

        {(data.managers?.length > 0 || data.members) && (
          <section className="pb-10">
            <SectionTitle icon={<Users size={16} />} title={t('groups.space.people')} count={data.members?.length} />
            {data.managers?.length > 0 && (
              <p className="mb-3 text-sm text-gray-500">
                {t('groups.space.managed_by', { names: data.managers.map((m: any) => personName(m)).join(', ') })}
              </p>
            )}
            {data.members && (
              <ul className="flex flex-wrap gap-2">
                {data.members.map((m: any) => (
                  <li key={m.id} className="flex items-center gap-2 rounded-full bg-white nice-shadow ps-1 pe-3 py-1">
                    <Avatar person={m} size={26} />
                    <span className="text-sm text-gray-800" dir="auto">{personName(m)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </GeneralWrapperStyled>
  )
}
