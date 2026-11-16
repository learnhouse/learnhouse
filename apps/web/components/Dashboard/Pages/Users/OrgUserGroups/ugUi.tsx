'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { Lightning, TreeStructure, UserList, UsersThree } from '@phosphor-icons/react'
import { Chip } from '@components/Dashboard/Shared/DashKit/DashKit'
import { Switch } from '@components/ui/switch'
import { getUserAvatarMediaDirectory } from '@services/media/media'
import { groupTile, personName, type GroupKind, type Person } from './groupsApi'

/** The colored tile shown before a group's name. */
export function GroupTile({ color, kind, size = 36 }: { color?: string | null; kind?: GroupKind; size?: number }) {
  const icon = kind === 'smart' ? <Lightning size={size / 2} weight="duotone" /> : <UsersThree size={size / 2} weight="duotone" />
  return (
    <span
      style={{ width: size, height: size }}
      className={`rounded-xl flex items-center justify-center shrink-0 ${groupTile(color, kind)}`}
    >
      {icon}
    </span>
  )
}

/** Manual / Smart / Nested chips. */
export function TypeChips({ types }: { types: string[] }) {
  const { t } = useTranslation()
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {types.includes('smart') && (
        <Chip tone="violet" icon={<Lightning size={11} weight="fill" />}>
          {t('groups.types.smart')}
        </Chip>
      )}
      {types.includes('manual') && (
        <Chip tone="sky" icon={<UserList size={11} weight="bold" />}>
          {t('groups.types.manual')}
        </Chip>
      )}
      {types.includes('nested') && (
        <Chip tone="amber" icon={<TreeStructure size={11} weight="bold" />}>
          {t('groups.types.nested')}
        </Chip>
      )}
    </span>
  )
}

/** "Pro" marker for features above the org's plan. */
export function ProChip() {
  const { t } = useTranslation()
  return <Chip tone="violet">{t('groups.plan.pro')}</Chip>
}

export function avatarSrc(p?: Partial<Person> | null): string {
  return p?.avatar_image && p.user_uuid ? getUserAvatarMediaDirectory(p.user_uuid, p.avatar_image) : ''
}

export function Avatar({ person, size = 28 }: { person: Partial<Person>; size?: number }) {
  const src = avatarSrc(person)
  const label = personName(person)
  return src ? (
    <img src={src} alt="" style={{ width: size, height: size }} className="rounded-full object-cover bg-neutral-100 shrink-0" />
  ) : (
    <span
      style={{ width: size, height: size }}
      className="rounded-full bg-neutral-200 text-neutral-600 text-[11px] font-bold flex items-center justify-center uppercase shrink-0"
      aria-hidden
    >
      {label.slice(0, 1)}
    </span>
  )
}

/** How someone is in a group: by hand, rules, a sub-group, a code... */
export function SourceChips({ sources }: { sources: string[] }) {
  const { t } = useTranslation()
  const tone: Record<string, 'neutral' | 'violet' | 'amber' | 'emerald' | 'sky'> = {
    manual: 'neutral',
    rule: 'violet',
    inherited: 'amber',
    code: 'emerald',
    import: 'sky',
    domain: 'sky',
    crm: 'sky',
  }
  const label: Record<string, string> = {
    manual: t('groups.sources.manual'),
    rule: t('groups.sources.rule'),
    inherited: t('groups.sources.inherited'),
    code: t('groups.sources.code'),
    import: t('groups.sources.import'),
    domain: t('groups.sources.domain'),
    crm: t('groups.sources.crm'),
  }
  return (
    <span className="inline-flex flex-wrap gap-1">
      {sources.map((s) => (
        <Chip key={s} tone={tone[s] ?? 'neutral'} className="!py-0.5 !px-2 !text-[11px]">
          {label[s] ?? s}
        </Chip>
      ))}
    </span>
  )
}

/** The kit's switch, pinned to light colors (the dashboard is always light). */
export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean
  onChange: (_v: boolean) => void
  label: string
  disabled?: boolean
}) {
  return (
    <Switch
      checked={checked}
      onCheckedChange={onChange}
      aria-label={label}
      disabled={disabled}
      className="data-[state=checked]:bg-neutral-900 data-[state=unchecked]:bg-neutral-200 [&>span]:bg-white"
    />
  )
}
