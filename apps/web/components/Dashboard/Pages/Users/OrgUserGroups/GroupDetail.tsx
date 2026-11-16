'use client'
import React, { useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import {
  ArrowLeft,
  ArrowSquareOut,
  ChartLineUp,
  ClockCounterClockwise,
  GearSix,
  Key,
  Lightning,
  Megaphone,
  UsersThree,
  WarningCircle,
} from '@phosphor-icons/react'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import { Button, Chip, EmptyState, FieldLabel, INPUT, TEXTAREA } from '@components/Dashboard/Shared/DashKit/DashKit'
import { SubTabPanel, SubTabs, useSubTab } from '@components/Dashboard/Shared/DashKit/SubTabs'
import { getUriWithOrg } from '@services/config/config'
import { RowSkeleton } from '../usersUi'
import AccessTab from './tabs/AccessTab'
import HistoryTab from './tabs/HistoryTab'
import MembersTab from './tabs/MembersTab'
import ProgressTab from './tabs/ProgressTab'
import RulesTab from './tabs/RulesTab'
import SettingsTab from './tabs/SettingsTab'
import { useGroupDetail, useInvalidateGroups, useUG, type GroupDetail } from './groupsApi'
import { GroupTile, Toggle, TypeChips } from './ugUi'

const SECTIONS = ['members', 'access', 'progress', 'rules', 'settings', 'history'] as const
type Section = (typeof SECTIONS)[number]

export default function GroupDetailView({ id, onBack, backLabel }: { id: number; onBack: () => void; backLabel?: string }) {
  const { t } = useTranslation()
  const { data: group, isLoading, error } = useGroupDetail(id)
  const [section, setSection] = useSubTab<Section>('members', SECTIONS, { rememberAs: 'usergroup-detail' })
  // ?announce=1 (the Announce shortcut on My groups) opens the composer.
  const params = useSearchParams()
  // null follows the URL; a click or close takes over from there.
  const [announceState, setAnnouncing] = useState<boolean | null>(null)
  const announcing = announceState ?? params?.get('announce') === '1'
  const { org } = useUG()

  if (isLoading) {
    return (
      <div className="bg-white rounded-2xl nice-shadow">
        <RowSkeleton rows={5} />
      </div>
    )
  }
  if (!group || error) {
    return (
      <div className="bg-white rounded-2xl nice-shadow">
        <EmptyState
          icon={<WarningCircle size={22} />}
          title={t('groups.detail.not_found')}
          action={<Button onClick={onBack}>{t('groups.detail.back')}</Button>}
        />
      </div>
    )
  }
  const caps = group.capabilities
  const admin = caps.admin
  const items = [
    { key: 'members' as const, label: t('groups.tabs.members'), icon: <UsersThree size={15} className="text-sky-600" />, badge: <span className="text-xs text-neutral-400 tabular-nums">{group.member_count}</span> },
    { key: 'access' as const, label: t('groups.tabs.access'), icon: <Key size={15} className="text-emerald-600" />, hidden: !admin },
    { key: 'progress' as const, label: t('groups.tabs.progress'), icon: <ChartLineUp size={15} className="text-violet-600" />, hidden: !caps.progress },
    { key: 'rules' as const, label: t('groups.tabs.rules'), icon: <Lightning size={15} className="text-amber-600" />, hidden: !admin },
    { key: 'settings' as const, label: t('groups.tabs.settings'), icon: <GearSix size={15} className="text-neutral-600" />, hidden: !admin },
    { key: 'history' as const, label: t('groups.tabs.history'), icon: <ClockCounterClockwise size={15} className="text-rose-600" /> },
  ]
  const spaceHref = getUriWithOrg(org?.slug, `/groups/${group.usergroup_uuid.replace('usergroup_', '')}`)

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <button type="button" onClick={onBack} className="self-start inline-flex items-center gap-1.5 text-sm font-medium text-neutral-500 hover:text-neutral-900">
          <ArrowLeft size={14} className="rtl:rotate-180" /> {backLabel ?? t('groups.detail.back')}
        </button>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <GroupTile color={group.color} kind={group.kind} size={44} />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-bold tracking-tight text-neutral-900 truncate" dir="auto" data-testid="group-title">
                  {group.name}
                </h2>
                <TypeChips types={group.types} />
                {caps.role === 'manager' && <Chip tone="emerald">{t('groups.detail.you_manage')}</Chip>}
              </div>
              <p className="text-sm text-neutral-500 truncate" dir="auto">
                {group.parent ? t('groups.detail.inside', { name: group.parent.name }) + (group.description ? ' · ' : '') : ''}
                {group.description}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {group.settings.space_enabled && group.features.space && (
              <Link href={spaceHref} target="_blank" className="inline-flex">
                <Button icon={<ArrowSquareOut size={14} className="text-sky-600" />}>{t('groups.detail.open_space')}</Button>
              </Link>
            )}
            {caps.post && group.features.messaging && (
              <Button variant="primary" icon={<Megaphone size={14} />} onClick={() => setAnnouncing(true)} data-testid="announce">
                {t('groups.announce.button')}
              </Button>
            )}
          </div>
        </div>
      </div>

      <SubTabs items={items} value={section} onChange={setSection} ariaLabel={t('groups.detail.sections')}>
        <SubTabPanel tab="members">
          <MembersTab group={group} />
        </SubTabPanel>
        {admin && (
          <SubTabPanel tab="access" unmountWhenHidden>
            <AccessTab group={group} />
          </SubTabPanel>
        )}
        {caps.progress && (
          <SubTabPanel tab="progress" unmountWhenHidden>
            <ProgressTab group={group} />
          </SubTabPanel>
        )}
        {admin && (
          <SubTabPanel tab="rules">
            <RulesTab key={`${group.id}-${group.kind}-${JSON.stringify(group.rules)}`} group={group} />
          </SubTabPanel>
        )}
        {admin && (
          <SubTabPanel tab="settings">
            <SettingsTab key={`${group.id}-${group.name}-${JSON.stringify(group.settings)}-${group.parent?.id}-${group.color}`} group={group} />
          </SubTabPanel>
        )}
        <SubTabPanel tab="history" unmountWhenHidden>
          <HistoryTab group={group} />
        </SubTabPanel>
      </SubTabs>

      <AnnounceDialog group={group} open={announcing} onOpenChange={setAnnouncing} />
    </div>
  )
}

function AnnounceDialog({ group, open, onOpenChange }: { group: GroupDetail; open: boolean; onOpenChange: (_open: boolean) => void }) {
  const { t } = useTranslation()
  const { call } = useUG()
  const invalidate = useInvalidateGroups()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [pinned, setPinned] = useState(false)
  const [email, setEmail] = useState(false)
  const [saving, setSaving] = useState(false)
  const submit = async () => {
    setSaving(true)
    try {
      const out = await call<any>('POST', `${group.id}/announcements`, { title, body, pinned, email: email && group.capabilities.admin })
      toast.success(out.email ? t('groups.announce.sent_email', { count: out.email.queued ?? 0 }) : t('groups.announce.posted'))
      invalidate(group.id)
      setTitle('')
      setBody('')
      setPinned(false)
      setEmail(false)
      onOpenChange(false)
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setSaving(false)
    }
  }
  return (
    <Modal
      isDialogOpen={open}
      onOpenChange={onOpenChange}
      size="md"
      icon={<Megaphone size={16} />}
      dialogTitle={t('groups.announce.title', { name: group.name })}
      dialogDescription={t('groups.announce.desc', { count: group.member_count })}
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
          <Button variant="primary" disabled={!title.trim()} loading={saving} onClick={submit}>
            {email ? t('groups.announce.post_and_email') : t('groups.announce.post')}
          </Button>
        </div>
      }
      dialogContent={
        <div className="flex flex-col gap-4">
          <label className="block">
            <FieldLabel>{t('groups.announce.subject')}</FieldLabel>
            <input className={INPUT} value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} autoFocus />
          </label>
          <label className="block">
            <FieldLabel hint={t('common.optional')}>{t('groups.announce.message')}</FieldLabel>
            <textarea className={TEXTAREA} rows={5} maxLength={10000} value={body} onChange={(e) => setBody(e.target.value)} />
          </label>
          <div className="flex flex-col gap-3 rounded-xl ring-1 ring-inset ring-neutral-200 px-3.5 py-3">
            <label className="flex items-center justify-between gap-4">
              <span className="text-sm text-neutral-800">{t('groups.announce.pin')}</span>
              <Toggle checked={pinned} onChange={setPinned} label={t('groups.announce.pin')} />
            </label>
            {group.capabilities.admin && (
              <label className="flex items-center justify-between gap-4">
                <span>
                  <span className="block text-sm text-neutral-800">{t('groups.announce.email')}</span>
                  <span className="block text-xs text-neutral-500">{t('groups.announce.email_hint')}</span>
                </span>
                <Toggle checked={email} onChange={setEmail} label={t('groups.announce.email')} />
              </label>
            )}
          </div>
        </div>
      }
    />
  )
}
