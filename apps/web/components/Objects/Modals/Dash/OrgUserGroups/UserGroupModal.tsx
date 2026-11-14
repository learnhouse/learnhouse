'use client'
import React, { useMemo, useState } from 'react'
import Link from 'next/link'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Books, Info, LinkBreak, LinkSimple, Plus, Users, UsersThree } from '@phosphor-icons/react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import ThumbnailImage from '@components/Objects/Thumbnails/ThumbnailImage'
import {
  Button,
  EmptyState,
  FieldLabel,
  INPUT,
  SegmentedControl,
  TEXTAREA,
} from '@components/Dashboard/Shared/DashKit/DashKit'
import { useUpgradeModal } from '@components/Dashboard/Shared/PlanRestricted/UpgradeModalContext'
import { getUriWithOrg } from '@services/config/config'
import { getCourseThumbnailMediaDirectory } from '@services/media/media'
import { getAllOrgCourses } from '@services/courses/courses'
import {
  createUserGroup,
  getUserGroupResources,
  linkResourcesToUserGroup,
  unLinkResourcesToUserGroup,
  updateUserGroup,
} from '@services/usergroups/usergroups'
import { asArray } from '@services/utils/ts/requests'
import { queryKeys } from '@/lib/query/keys'
import { useLHAnalytics, AnalyticsEvent } from '@services/analytics'
import ManageUsers from './ManageUsers'

export type GroupTab = 'members' | 'courses' | 'details'

// Linked resource uuids for one group. Shared by the list row (for the
// course count) and the Courses tab.
export function useGroupResources(usergroupId: number | undefined) {
  const org = useOrg() as any
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  return useQuery({
    queryKey: queryKeys.usergroups.resources(String(usergroupId), org?.id),
    queryFn: async () => asArray<string>(await getUserGroupResources(usergroupId, org.id, access_token)),
    enabled: !!usergroupId && !!org?.id && !!access_token,
    staleTime: 60_000,
  })
}

// Same query (and key) as the Courses page, so the list is usually cached.
function useOrgCourses() {
  const org = useOrg() as any
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  return useQuery({
    queryKey: queryKeys.courses.dashAll(org?.slug),
    queryFn: () => getAllOrgCourses(org.slug, access_token),
    enabled: !!org?.slug && !!access_token,
    staleTime: 60_000,
  })
}

// Courses the group's members can access. Linking is instant and shows at
// once; the server answer then confirms or reverts it.
function GroupCourses({ usergroupId }: { usergroupId: number }) {
  const { t } = useTranslation()
  const org = useOrg() as any
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const queryClient = useQueryClient()
  const { data: resources, isLoading } = useGroupResources(usergroupId)
  const { data: courses, isLoading: coursesLoading } = useOrgCourses()
  const [picked, setPicked] = useState('')
  const [pending, setPending] = useState<string | null>(null)

  const key = queryKeys.usergroups.resources(String(usergroupId), org?.id)
  const linkedSet = useMemo(() => new Set(resources ?? []), [resources])
  const allCourses: any[] = asArray(courses)
  const linked = allCourses.filter((c) => linkedSet.has(c.course_uuid))
  const available = allCourses.filter((c) => !linkedSet.has(c.course_uuid))
  const otherCount = (resources ?? []).filter((uuid) => !uuid.startsWith('course_')).length

  const sync = () => {
    queryClient.invalidateQueries({ queryKey: key })
    // The Courses page's group filter and the course Access tab keep their
    // own copies.
    queryClient.invalidateQueries({ queryKey: ['usergroups', org?.id] })
    queryClient.invalidateQueries({ queryKey: ['courseUsergroups'] })
  }

  const change = async (courseUuid: string, link: boolean) => {
    setPending(courseUuid)
    const previous = queryClient.getQueryData<string[]>(key)
    queryClient.setQueryData<string[]>(key, (old) =>
      link ? [...(old ?? []), courseUuid] : (old ?? []).filter((u) => u !== courseUuid)
    )
    try {
      const res = link
        ? await linkResourcesToUserGroup(usergroupId, courseUuid, org.id, access_token)
        : await unLinkResourcesToUserGroup(usergroupId, courseUuid, org.id, access_token)
      if (res.status === 200) {
        toast.success(link ? t('access.usergroups.link_success') : t('access.usergroups.unlink_success'))
        if (link) setPicked('')
      } else {
        queryClient.setQueryData(key, previous)
        toast.error(link ? t('access.usergroups.link_error') : t('access.usergroups.unlink_error'))
      }
    } catch {
      queryClient.setQueryData(key, previous)
      toast.error(link ? t('access.usergroups.link_error') : t('access.usergroups.unlink_error'))
    } finally {
      setPending(null)
      sync()
    }
  }

  const loading = (isLoading && !resources) || (coursesLoading && !courses)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col sm:flex-row gap-2">
        <select
          value={picked}
          onChange={(e) => setPicked(e.target.value)}
          aria-label={t('dashboard.users.dash.groups.pick_course')}
          disabled={!available.length}
          className={`${INPUT} sm:flex-1 disabled:opacity-60`}
        >
          <option value="">
            {available.length ? t('dashboard.users.dash.groups.pick_course') : t('dashboard.users.dash.groups.all_courses_linked')}
          </option>
          {available.map((c) => (
            <option key={c.course_uuid} value={c.course_uuid}>
              {c.name}
            </option>
          ))}
        </select>
        <Button
          variant="primary"
          icon={<LinkSimple size={14} />}
          disabled={!picked}
          loading={!!picked && pending === picked}
          onClick={() => picked && change(picked, true)}
        >
          {t('dashboard.users.dash.groups.link_course')}
        </Button>
      </div>
      <p className="-mt-2 text-xs text-neutral-400">{t('dashboard.users.dash.groups.courses_hint')}</p>

      <div className="rounded-xl ring-1 ring-inset ring-neutral-200 overflow-hidden">
        {loading ? (
          <div className="divide-y divide-neutral-100 animate-pulse">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3">
                <div className="w-16 aspect-video rounded-md bg-neutral-100" />
                <div className="h-3.5 w-48 rounded bg-neutral-100" />
              </div>
            ))}
          </div>
        ) : linked.length === 0 ? (
          <EmptyState
            icon={<Books size={22} />}
            title={t('dashboard.users.dash.groups.no_courses')}
            description={t('dashboard.users.dash.groups.no_courses_description')}
          />
        ) : (
          <ul className="divide-y divide-neutral-100 max-h-[380px] overflow-y-auto">
            {linked.map((c) => (
              <li key={c.course_uuid} className="flex items-center gap-3 px-4 py-2.5">
                <ThumbnailImage
                  src={
                    c.thumbnail_image
                      ? getCourseThumbnailMediaDirectory(org?.org_uuid, c.course_uuid, c.thumbnail_image)
                      : '/empty_thumbnail.png'
                  }
                  className="w-16 aspect-video rounded-md ring-1 ring-black/5 shrink-0"
                />
                <Link
                  href={getUriWithOrg(org?.slug, `/dash/courses/course/${String(c.course_uuid).replace('course_', '')}/access`)}
                  className="min-w-0 flex-1 text-sm font-semibold text-neutral-900 truncate hover:underline underline-offset-2"
                  dir="auto"
                >
                  {c.name}
                </Link>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<LinkBreak size={12} />}
                  loading={pending === c.course_uuid}
                  onClick={() => change(c.course_uuid, false)}
                >
                  {t('dashboard.users.dash.groups.unlink')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {otherCount > 0 && (
        <p className="text-xs text-neutral-500">{t('dashboard.users.dash.groups.other_resources', { count: otherCount })}</p>
      )}
    </div>
  )
}

function DetailsFields({
  name,
  description,
  onName,
  onDescription,
  error,
}: {
  name: string
  description: string
  onName: (_v: string) => void
  onDescription: (_v: string) => void
  error?: string
}) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-4">
      <div>
        <FieldLabel error={error} hint={t('dashboard.users.dash.groups.name_hint')}>
          {t('dashboard.users.usergroups.modals.create.form.name')}
        </FieldLabel>
        <input
          autoFocus
          value={name}
          onChange={(e) => onName(e.target.value)}
          maxLength={100}
          placeholder={t('dashboard.users.dash.groups.name_placeholder')}
          className={INPUT}
        />
      </div>
      <div>
        <FieldLabel hint={t('dashboard.users.dash.groups.description_hint')}>
          {t('dashboard.users.usergroups.modals.create.form.description')}
        </FieldLabel>
        <textarea
          value={description}
          onChange={(e) => onDescription(e.target.value)}
          rows={3}
          placeholder={t('dashboard.users.dash.groups.description_placeholder')}
          className={TEXTAREA}
        />
      </div>
    </div>
  )
}

// One modal per group with three tabs: who is in it, what it unlocks, and
// its name. Only the Details tab has a save button; the other two apply
// each change as it is made.
export function UserGroupModal({
  group,
  tab,
  onTabChange,
  onOpenChange,
}: {
  group: any | null
  tab: GroupTab
  onTabChange: (_tab: GroupTab) => void
  onOpenChange: (_open: boolean) => void
}) {
  const { t } = useTranslation()
  const org = useOrg() as any
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)

  // Reset the form whenever another group opens.
  const groupId = group?.id
  const [formFor, setFormFor] = useState<number | undefined>(undefined)
  if (formFor !== groupId) {
    setFormFor(groupId)
    setName(group?.name ?? '')
    setDescription(group?.description ?? '')
  }

  const dirty = !!group && (name !== (group.name ?? '') || description !== (group.description ?? ''))

  const save = async () => {
    if (!group || !name.trim()) return
    setSaving(true)
    const listKey = queryKeys.usergroups.list(org.id)
    const previous = queryClient.getQueryData(listKey)
    // Rename in place right away; the list rows read from this cache.
    queryClient.setQueryData(listKey, (old: any) => {
      const patch = (list: any[]) => list.map((g) => (g.id === group.id ? { ...g, name, description } : g))
      if (Array.isArray(old)) return patch(old)
      if (Array.isArray(old?.data)) return { ...old, data: patch(old.data) }
      return old
    })
    const res = await updateUserGroup(group.id, org.id, access_token, { name: name.trim(), description })
    setSaving(false)
    if (res.status == 200) {
      toast.success(t('dashboard.users.usergroups.modals.edit.toasts.success'))
    } else {
      queryClient.setQueryData(listKey, previous)
      toast.error(t('dashboard.users.usergroups.modals.edit.toasts.error'))
    }
    queryClient.invalidateQueries({ queryKey: listKey })
  }

  return (
    <Modal
      isDialogOpen={!!group}
      onOpenChange={onOpenChange}
      size="lg"
      preventClose={saving}
      icon={<UsersThree size={16} />}
      dialogTitle={group?.name}
      dialogDescription={group?.description || t('dashboard.users.dash.groups.modal_description')}
      dialogContent={
        group ? (
          // A fixed floor keeps the dialog from jumping as tabs switch.
          <div className="flex flex-col gap-5 md:min-h-[460px]">
            <SegmentedControl<GroupTab>
              value={tab}
              onChange={onTabChange}
              ariaLabel={t('dashboard.users.dash.groups.tabs_label')}
              options={[
                { key: 'members', label: t('dashboard.users.dash.groups.tab_members') },
                { key: 'courses', label: t('dashboard.users.dash.groups.tab_courses') },
                { key: 'details', label: t('dashboard.users.dash.groups.tab_details') },
              ]}
            />
            {tab === 'members' && <ManageUsers usergroup_id={group.id} />}
            {tab === 'courses' && <GroupCourses usergroupId={group.id} />}
            {tab === 'details' && (
              <DetailsFields
                name={name}
                description={description}
                onName={setName}
                onDescription={setDescription}
                error={!name.trim() ? t('dashboard.users.usergroups.modals.edit.form.name_required') : undefined}
              />
            )}
          </div>
        ) : null
      }
      footer={
        tab === 'details' ? (
          <>
            <Button onClick={() => onOpenChange(false)} disabled={saving}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" onClick={save} loading={saving} disabled={!dirty || !name.trim()}>
              {t('dashboard.kit.save')}
            </Button>
          </>
        ) : (
          <Button onClick={() => onOpenChange(false)}>{t('dashboard.users.dash.done')}</Button>
        )
      }
    />
  )
}

// Create a group, then go straight to adding its members.
export function CreateUserGroupModal({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (_open: boolean) => void
  onCreated: (_group: any) => void
}) {
  const { t } = useTranslation()
  const org = useOrg() as any
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const queryClient = useQueryClient()
  const { track } = useLHAnalytics('dashboard')
  const { handlePlanLimit } = useUpgradeModal()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [touched, setTouched] = useState(false)

  const close = (next: boolean) => {
    onOpenChange(next)
    if (!next) {
      setName('')
      setDescription('')
      setTouched(false)
    }
  }

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault()
    setTouched(true)
    if (!name.trim()) return
    setSubmitting(true)
    const res = await createUserGroup({ name: name.trim(), description, org_id: org?.id }, access_token)
    setSubmitting(false)
    if (res.status == 200) {
      track(AnalyticsEvent.UsergroupCreated)
      queryClient.invalidateQueries({ queryKey: queryKeys.usergroups.list(org.id) })
      toast.success(t('dashboard.users.usergroups.modals.create.toasts.success'))
      close(false)
      if (res.data?.id) onCreated(res.data)
    } else if (handlePlanLimit(res, { source: 'usergroup_create', feature: 'usergroups', requiredPlan: 'standard' })) {
      // A free org at its quota gets the upgrade prompt instead of an error.
      close(false)
    } else {
      toast.error(t('dashboard.users.usergroups.modals.create.toasts.error'))
    }
  }

  return (
    <Modal
      isDialogOpen={open}
      onOpenChange={close}
      size="sm"
      preventClose={submitting}
      icon={<Users size={16} />}
      dialogTitle={t('dashboard.users.usergroups.modals.create.title')}
      dialogDescription={t('dashboard.users.usergroups.modals.create.description')}
      dialogContent={
        <form id="create-usergroup" onSubmit={submit} className="flex flex-col gap-4">
          <DetailsFields
            name={name}
            description={description}
            onName={setName}
            onDescription={setDescription}
            error={touched && !name.trim() ? t('dashboard.users.usergroups.modals.create.form.name_required') : undefined}
          />
          <p className="flex items-start gap-2 text-xs text-neutral-500">
            <Info size={14} className="shrink-0 mt-px" />
            {t('dashboard.users.dash.groups.create_next_hint')}
          </p>
        </form>
      }
      footer={
        <>
          <Button onClick={() => close(false)} disabled={submitting}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="create-usergroup" variant="primary" icon={<Plus size={14} />} loading={submitting}>
            {t('dashboard.users.usergroups.modals.create.form.submit')}
          </Button>
        </>
      }
    />
  )
}
