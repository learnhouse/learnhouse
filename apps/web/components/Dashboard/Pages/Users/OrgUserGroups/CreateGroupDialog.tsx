'use client'
import React, { useState } from 'react'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import { Lightning, Lock, TreeStructure, UserList, UsersThree } from '@phosphor-icons/react'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import { Button, FieldLabel, INPUT, TEXTAREA } from '@components/Dashboard/Shared/DashKit/DashKit'
import { useUpgradeModal } from '@components/Dashboard/Shared/PlanRestricted/UpgradeModalContext'
import RuleBuilder, { emptyRules } from './RuleBuilder'
import { GROUP_COLORS, useInvalidateGroups, useUG, type GroupFeatures, type GroupListItem, type Rules } from './groupsApi'
import { ProChip, Toggle } from './ugUi'

type Kind = 'manual' | 'smart' | 'nested'

export default function CreateGroupDialog({
  open,
  onOpenChange,
  features,
  groups,
  onCreated,
}: {
  open: boolean
  onOpenChange: (_open: boolean) => void
  features?: GroupFeatures
  groups: GroupListItem[]
  onCreated: (_id: number) => void
}) {
  const { t } = useTranslation()
  const { call, orgId } = useUG()
  const invalidate = useInvalidateGroups()
  const { handlePlanLimit, showUpgrade } = useUpgradeModal()
  const [kind, setKind] = useState<Kind | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [color, setColor] = useState<string>('sky')
  const [parent, setParent] = useState('')
  const [rules, setRules] = useState<Rules>(emptyRules())
  const [alsoManual, setAlsoManual] = useState(false)
  const [saving, setSaving] = useState(false)

  const reset = () => {
    setKind(null)
    setName('')
    setDescription('')
    setColor('sky')
    setParent('')
    setRules(emptyRules())
    setAlsoManual(false)
  }
  const close = (o: boolean) => {
    if (!o) reset()
    onOpenChange(o)
  }

  const locked = (k: Kind) => (k === 'smart' && !features?.smart) || (k === 'nested' && !features?.nesting)

  const submit = async () => {
    if (!name.trim() || !kind) return
    setSaving(true)
    try {
      const body: any = { name: name.trim(), description: description.trim(), color, kind: 'manual' }
      if (kind === 'smart') {
        body.kind = alsoManual ? 'hybrid' : 'smart'
        body.rules = rules
      }
      if (kind === 'nested' && parent) body.parent_uuid = parent
      const created = await call<any>('POST', `org/${orgId}/groups`, body)
      toast.success(t('groups.create.created', { name: created.name }))
      invalidate()
      close(false)
      onCreated(created.id)
    } catch (e: any) {
      if (!handlePlanLimit({ data: { detail: e?.message } })) toast.error(e?.message || t('groups.errors.generic'))
    } finally {
      setSaving(false)
    }
  }

  const cards: { key: Kind; icon: React.ReactNode; tile: string }[] = [
    { key: 'manual', icon: <UserList size={26} weight="duotone" />, tile: 'bg-sky-50 text-sky-600' },
    { key: 'smart', icon: <Lightning size={26} weight="duotone" />, tile: 'bg-violet-50 text-violet-600' },
    { key: 'nested', icon: <TreeStructure size={26} weight="duotone" />, tile: 'bg-amber-50 text-amber-600' },
  ]

  return (
    <Modal
      isDialogOpen={open}
      onOpenChange={close}
      size={kind === 'smart' ? 'lg' : 'md'}
      icon={<UsersThree size={16} />}
      onBack={kind ? () => setKind(null) : undefined}
      dialogTitle={kind ? t(`groups.create.title_${kind}`) : t('groups.create.title')}
      dialogDescription={kind ? t(`groups.create.desc_${kind}`) : t('groups.create.subtitle')}
      footer={
        kind ? (
          <div className="flex justify-end gap-2">
            <Button onClick={() => close(false)}>{t('common.cancel')}</Button>
            <Button
              variant="primary"
              onClick={submit}
              loading={saving}
              disabled={!name.trim() || (kind === 'nested' && !parent)}
            >
              {t('groups.create.submit')}
            </Button>
          </div>
        ) : undefined
      }
      dialogContent={
        !kind ? (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 py-1">
            {cards.map((c) => {
              const isLocked = locked(c.key)
              return (
                <button
                  key={c.key}
                  type="button"
                  data-testid={`group-type-${c.key}`}
                  onClick={() => (isLocked ? showUpgrade() : setKind(c.key))}
                  className={`group flex flex-col items-center text-center p-6 max-sm:p-4 rounded-xl border-2 bg-white transition-all duration-200 ${
                    isLocked ? 'border-neutral-100' : 'border-neutral-200 hover:border-neutral-900 hover:shadow-lg'
                  }`}
                >
                  <span
                    className={`w-14 h-14 max-sm:w-11 max-sm:h-11 rounded-full flex items-center justify-center mb-4 max-sm:mb-2 ${
                      isLocked ? 'bg-neutral-100 text-neutral-400' : c.tile
                    }`}
                  >
                    {isLocked ? <Lock size={24} /> : c.icon}
                  </span>
                  <span className="flex items-center gap-1.5 mb-1">
                    <span className={`font-semibold ${isLocked ? 'text-neutral-500' : 'text-neutral-900'}`}>{t(`groups.create.card_${c.key}`)}</span>
                    {isLocked && <ProChip />}
                  </span>
                  <span className="text-sm text-neutral-500">{t(`groups.create.card_${c.key}_desc`)}</span>
                </button>
              )
            })}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-4">
              <label className="block">
                <FieldLabel>{t('groups.fields.name')}</FieldLabel>
                <input
                  autoFocus
                  className={INPUT}
                  value={name}
                  maxLength={100}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t(`groups.create.name_placeholder_${kind}`)}
                  data-testid="group-name"
                />
              </label>
              <div>
                <FieldLabel>{t('groups.fields.color')}</FieldLabel>
                <div className="flex items-center gap-1.5 h-9" role="radiogroup" aria-label={t('groups.fields.color')}>
                  {Object.entries(GROUP_COLORS).map(([key, c]) => (
                    <button
                      key={key}
                      type="button"
                      role="radio"
                      aria-checked={color === key}
                      aria-label={key}
                      onClick={() => setColor(key)}
                      className={`w-6 h-6 rounded-full ${c.dot} transition-transform ${
                        color === key ? 'ring-2 ring-offset-2 ring-neutral-900 scale-105' : 'hover:scale-110'
                      }`}
                    />
                  ))}
                </div>
              </div>
            </div>
            <label className="block">
              <FieldLabel hint={t('common.optional')}>{t('groups.fields.description')}</FieldLabel>
              <textarea
                className={TEXTAREA}
                rows={2}
                maxLength={500}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </label>
            {kind === 'nested' && (
              <label className="block">
                <FieldLabel hint={t('groups.create.parent_hint')}>{t('groups.fields.parent')}</FieldLabel>
                <select className={`${INPUT} cursor-pointer`} value={parent} onChange={(e) => setParent(e.target.value)}>
                  <option value="">{t('groups.create.pick_parent')}</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.usergroup_uuid}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {kind === 'smart' && (
              <div className="flex flex-col gap-3">
                <FieldLabel>{t('groups.fields.rules')}</FieldLabel>
                <RuleBuilder value={rules} onChange={setRules} />
                <div className="flex items-center justify-between gap-4 rounded-xl ring-1 ring-inset ring-neutral-200 px-3.5 py-3">
                  <div>
                    <p className="text-sm font-semibold text-neutral-900">{t('groups.create.also_manual')}</p>
                    <p className="text-xs text-neutral-500">{t('groups.create.also_manual_hint')}</p>
                  </div>
                  <Toggle checked={alsoManual} onChange={setAlsoManual} label={t('groups.create.also_manual')} />
                </div>
              </div>
            )}
          </div>
        )
      }
    />
  )
}
