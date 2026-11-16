'use client'
import React, { useState } from 'react'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import { ArrowsClockwise, At, Lightning, ListChecks, UserList } from '@phosphor-icons/react'
import { Button, ChoiceCard, INPUT, SectionCard, StickySaveBar, formatRelative } from '@components/Dashboard/Shared/DashKit/DashKit'
import RuleBuilder, { emptyRules } from '../RuleBuilder'
import { useInvalidateGroups, useUG, type GroupDetail, type GroupKind, type Rules } from '../groupsApi'
import { ProChip } from '../ugUi'

export default function RulesTab({ group }: { group: GroupDetail }) {
  const { t, i18n } = useTranslation()
  const { call } = useUG()
  const invalidate = useInvalidateGroups()
  const initialRules: Rules = group.rules?.conditions?.length ? group.rules : emptyRules()
  const [kind, setKind] = useState<GroupKind>(group.kind)
  const [rules, setRules] = useState<Rules>(initialRules)
  const [domains, setDomains] = useState((group.settings.auto_join_domains || []).join(', '))
  const [saving, setSaving] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const smartAllowed = group.features.smart

  const dirty =
    kind !== group.kind ||
    JSON.stringify(rules) !== JSON.stringify(initialRules) ||
    domains !== (group.settings.auto_join_domains || []).join(', ')

  const save = async () => {
    setSaving(true)
    try {
      const body: any = {
        kind,
        settings: { auto_join_domains: domains.split(/[\s,]+/).map((d) => d.trim().replace(/^@/, '')).filter(Boolean) },
      }
      if (kind !== 'manual') body.rules = { ...rules, conditions: rules.conditions }
      const out = await call<GroupDetail>('PUT', `${group.id}/settings`, body)
      toast.success(t('groups.rules.saved', { count: out.member_count }))
      invalidate(group.id)
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setSaving(false)
    }
  }
  const sync = async () => {
    setSyncing(true)
    try {
      const s = await call<any>('POST', `${group.id}/sync`)
      toast.success(t('groups.rules.synced', { added: s.added, removed: s.removed }))
      invalidate(group.id)
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setSyncing(false)
    }
  }

  const modes: { key: GroupKind; icon: React.ReactNode; locked: boolean }[] = [
    { key: 'manual', icon: <UserList size={18} />, locked: false },
    { key: 'smart', icon: <Lightning size={18} weight="fill" />, locked: !smartAllowed },
    { key: 'hybrid', icon: <ListChecks size={18} />, locked: !smartAllowed },
  ]

  return (
    <div className="flex flex-col gap-5">
      <SectionCard icon={<Lightning size={18} className="text-violet-600" />} title={t('groups.rules.mode_title')} description={t('groups.rules.mode_desc')}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3" role="radiogroup">
          {modes.map((m) => (
            // The kit's ChoiceCard sizes to its text; stretch it so the three
            // cards share the row equally and match heights.
            <div key={m.key} className="relative grid [&>button]:w-full [&>button]:h-full [&>button]:pe-12">
              <ChoiceCard
                selected={kind === m.key}
                onClick={() => !m.locked && setKind(m.key)}
                icon={m.icon}
                title={t(`groups.rules.modes.${m.key}`)}
                description={t(`groups.rules.modes.${m.key}_desc`)}
              />
              {m.locked && (
                <span className="absolute top-2 end-2">
                  <ProChip />
                </span>
              )}
            </div>
          ))}
        </div>
      </SectionCard>

      {kind !== 'manual' && (
        <SectionCard
          icon={<ListChecks size={18} className="text-violet-600" />}
          title={t('groups.rules.title')}
          description={t('groups.rules.desc')}
          actions={
            <Button size="sm" icon={<ArrowsClockwise size={13} />} loading={syncing} onClick={sync} disabled={dirty}>
              {t('groups.rules.sync_now')}
            </Button>
          }
        >
          <RuleBuilder value={rules} onChange={setRules} groupId={group.id} />
          <p className="mt-4 text-xs text-neutral-500">
            {group.last_synced_at
              ? t('groups.rules.last_synced', { when: formatRelative(group.last_synced_at, i18n.language) })
              : t('groups.rules.never_synced')}{' '}
            {t('groups.rules.sync_hint')}
          </p>
        </SectionCard>
      )}

      <SectionCard icon={<At size={18} className="text-sky-600" />} title={t('groups.rules.domains_title')} description={t('groups.rules.domains_desc')}>
        <input
          className={INPUT}
          value={domains}
          onChange={(e) => setDomains(e.target.value)}
          placeholder={t('groups.rules.placeholders.domains')}
          aria-label={t('groups.rules.domains_title')}
        />
      </SectionCard>

      <StickySaveBar
        visible={dirty}
        saving={saving}
        onSave={save}
        onDiscard={() => {
          setKind(group.kind)
          setRules(initialRules)
          setDomains((group.settings.auto_join_domains || []).join(', '))
        }}
      />
    </div>
  )
}
