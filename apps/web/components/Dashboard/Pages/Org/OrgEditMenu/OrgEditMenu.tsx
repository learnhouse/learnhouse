'use client'
import React, { useState, useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { toast } from 'react-hot-toast'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { revalidateTags } from '@services/utils/ts/requests'
import { updateOrgMenuConfig, MenuLinkItem } from '@services/settings/org'
import { useTranslation } from 'react-i18next'
import { PlanLevel, planMeetsRequirement } from '@services/plans/plans'
import PlanBadge from '@components/Dashboard/Shared/PlanRestricted/PlanBadge'
import useAdminStatus from '@components/Hooks/useAdminStatus'
import { usePlan } from '@components/Hooks/usePlan'
import { Switch } from '@components/ui/switch'
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd'
import {
  Books, FolderSimple, Headphones, Lightning, ShoppingBag, Circuitry, VideoCamera,
  DotsSixVertical, Lock, Trash, Plus, CaretDown, LinkSimple, List as ListIcon, ShieldWarning,
  Garage, ChalkboardSimple,
} from '@phosphor-icons/react'
import { Button, INPUT, SectionCard, StickySaveBar } from '@components/Dashboard/Shared/DashKit/DashKit'
import { Notice } from '@components/Dashboard/Pages/Org/OrgSettingsShared/orgSettingsUi'
import { MENU_ICONS, MENU_ICON_NAMES, menuIcon, DEFAULT_MENU_ICON } from '@components/Objects/Menus/menuIcons'

type BuiltinMeta = { feature: string; link: string; labelKey: string; Icon: any }

const BUILTIN_META: Record<string, BuiltinMeta> = {
  courses: { feature: 'courses', link: '/courses', labelKey: 'courses.courses', Icon: Books },
  paths: { feature: 'paths', link: '/paths', labelKey: 'paths.title', Icon: Circuitry },
  library: { feature: 'folders', link: '/library', labelKey: 'library.library', Icon: FolderSimple },
  podcasts: { feature: 'podcasts', link: '/podcasts', labelKey: 'podcasts.podcasts', Icon: Headphones },
  live: { feature: 'live_sessions', link: '/live', labelKey: 'live_sessions.nav', Icon: VideoCamera },
  communities: { feature: 'communities', link: '/communities', labelKey: 'communities.title', Icon: Garage },
  playgrounds: { feature: 'playgrounds', link: '/playgrounds', labelKey: 'common.playgrounds', Icon: Lightning },
  boards: { feature: 'boards', link: '/boards', labelKey: 'common.boards', Icon: ChalkboardSimple },
  store: { feature: 'payments', link: '/store', labelKey: 'common.store', Icon: ShoppingBag },
}
const BUILTIN_ORDER = ['courses', 'paths', 'library', 'podcasts', 'live', 'communities', 'playgrounds', 'boards', 'store']

function defaultLabel(type: string, t: any): string {
  return BUILTIN_META[type] ? t(BUILTIN_META[type].labelKey) : ''
}

// Compact icon tile that opens a popover grid of selectable Phosphor icons.
// The grid renders in a portal with fixed positioning so it never clips inside
// the card, never shifts the layout, and flips above the tile near the page
// bottom. Used for custom links (built-ins keep their fixed brand icon).
const ICON_POPOVER_W = 232
const ICON_POPOVER_H = 188

function IconPicker({
  value,
  onChange,
  disabled,
}: {
  value?: string
  onChange: (_name: string) => void
  disabled?: boolean
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [coords, setCoords] = useState<{ left: number; top: number }>({ left: 0, top: 0 })
  const btnRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const Current = menuIcon(value)

  const place = () => {
    const r = btnRef.current?.getBoundingClientRect()
    if (!r) return
    const margin = 8
    let left = r.left
    if (left + ICON_POPOVER_W > window.innerWidth - margin) {
      left = window.innerWidth - ICON_POPOVER_W - margin
    }
    left = Math.max(margin, left)
    // Flip above the tile when there isn't room below it.
    const roomBelow = window.innerHeight - r.bottom
    const top = roomBelow > ICON_POPOVER_H + margin ? r.bottom + 6 : r.top - ICON_POPOVER_H - 6
    setCoords({ left, top })
  }

  const toggle = () => {
    if (open) {
      setOpen(false)
      return
    }
    place()
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (popRef.current?.contains(e.target as Node) || btnRef.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    // Reposition is brittle on scroll/resize, so just dismiss instead.
    const onMove = () => setOpen(false)
    document.addEventListener('mousedown', onDown)
    window.addEventListener('scroll', onMove, true)
    window.addEventListener('resize', onMove)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('scroll', onMove, true)
      window.removeEventListener('resize', onMove)
    }
  }, [open])

  return (
    <div className="relative flex-shrink-0">
      <button
        ref={btnRef}
        type="button"
        disabled={disabled}
        onClick={toggle}
        aria-label={t('dashboard.organization.menu.change_icon')}
        title={t('dashboard.organization.menu.change_icon')}
        className={`relative w-9 h-9 flex items-center justify-center bg-white rounded-lg ring-1 ring-inset ring-neutral-200 hover:bg-neutral-50 transition-colors disabled:opacity-50 ${open ? 'ring-2 ring-neutral-900/15' : ''}`}
      >
        {/* eslint-disable-next-line react-hooks/static-components */}
        <Current size={18} weight="fill" className="text-neutral-600" />
        <span className="absolute -bottom-0.5 -end-0.5 w-3 h-3 rounded-full bg-neutral-900 flex items-center justify-center ring-2 ring-white">
          <CaretDown size={7} weight="bold" className="text-white" />
        </span>
      </button>
      {open && typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={popRef}
            style={{ position: 'fixed', left: coords.left, top: coords.top, width: ICON_POPOVER_W }}
            className="z-[100] p-2 bg-white rounded-xl shadow-2xl ring-1 ring-black/5 grid grid-cols-6 gap-1"
          >
            {MENU_ICON_NAMES.map((name) => {
              const IconOpt = MENU_ICONS[name]
              const selected = (value || DEFAULT_MENU_ICON) === name
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() => {
                    onChange(name)
                    setOpen(false)
                  }}
                  title={name}
                  className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${selected ? 'bg-neutral-900 text-white' : 'text-neutral-500 hover:bg-neutral-100'}`}
                >
                  <IconOpt size={16} weight="fill" />
                </button>
              )
            })}
          </div>,
          document.body
        )}
    </div>
  )
}

// Merge stored config with the built-in set so newly-added features always appear.
function buildInitialItems(stored: MenuLinkItem[] | undefined): MenuLinkItem[] {
  const items: MenuLinkItem[] = []
  const seen = new Set<string>()
  if (stored && stored.length) {
    stored.forEach((it, i) => {
      items.push({ ...it, order: i })
      if (it.type !== 'custom') seen.add(it.type)
    })
  }
  // Append any built-in not already present
  BUILTIN_ORDER.forEach((type) => {
    if (!seen.has(type)) items.push({ type, enabled: true, order: items.length, label: '', url: '', icon: '' })
  })
  return items.map((it, i) => ({ ...it, order: i }))
}

const OrgEditMenu: React.FC = () => {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const org = useOrg() as any
  const queryClient = useQueryClient()
  const currentPlan = usePlan()
  const { rights } = useAdminStatus()
  const canEdit = rights?.organizations?.action_update === true

  const rf = org?.config?.config?.resolved_features
  const storedMenu: MenuLinkItem[] | undefined =
    org?.config?.config?.customization?.menu?.items ?? org?.config?.config?.general?.menu?.items

  const [items, setItems] = useState<MenuLinkItem[]>([])
  const [saving, setSaving] = useState(false)
  const [newLabel, setNewLabel] = useState('')
  const [newUrl, setNewUrl] = useState('')
  const [newIcon, setNewIcon] = useState(DEFAULT_MENU_ICON)

  useEffect(() => {
    setItems(buildInitialItems(storedMenu))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(storedMenu)])

  const dirty = useMemo(
    () => JSON.stringify(buildInitialItems(storedMenu)) !== JSON.stringify(items),
    [items, storedMenu]
  )

  const featureState = (type: string) => {
    const meta = BUILTIN_META[type]
    if (!meta) return { requiredPlan: undefined as any, planAllowed: true, featureEnabled: true }
    const requiredPlan = rf?.[meta.feature]?.required_plan
    const planAllowed = !requiredPlan || planMeetsRequirement(currentPlan, requiredPlan as PlanLevel)
    const featureEnabled = rf?.[meta.feature]?.enabled === true
    return { requiredPlan, planAllowed, featureEnabled }
  }

  const onDragEnd = (result: DropResult) => {
    if (!result.destination) return
    const next = [...items]
    const [moved] = next.splice(result.source.index, 1)
    next.splice(result.destination.index, 0, moved)
    setItems(next.map((it, i) => ({ ...it, order: i })))
  }

  const setItem = (idx: number, patch: Partial<MenuLinkItem>) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)))
  }
  const removeItem = (idx: number) => {
    setItems((prev) => prev.filter((_, i) => i !== idx).map((it, i) => ({ ...it, order: i })))
  }

  const addCustom = () => {
    if (!newUrl.trim() || !newLabel.trim()) {
      toast.error(t('dashboard.organization.menu.custom_required'))
      return
    }
    setItems((prev) => [
      ...prev,
      { type: 'custom', enabled: true, order: prev.length, label: newLabel.trim(), url: newUrl.trim(), icon: newIcon },
    ])
    setNewLabel('')
    setNewUrl('')
    setNewIcon(DEFAULT_MENU_ICON)
  }

  const save = async () => {
    if (!canEdit) {
      toast.error(t('dashboard.organization.features.toasts.admin_only'))
      return
    }
    setSaving(true)
    const tid = toast.loading(t('dashboard.organization.menu.saving'))
    try {
      await updateOrgMenuConfig(String(org.id), { items: items.map((it, i) => ({ ...it, order: i })) }, access_token)
      await revalidateTags(['organizations'], org.slug)
      queryClient.invalidateQueries({ queryKey: queryKeys.org.detail(org.slug) })
      toast.success(t('dashboard.organization.menu.saved'), { id: tid })
    } catch (e: any) {
      toast.error(e?.message || t('dashboard.organization.menu.error'), { id: tid })
    } finally {
      setSaving(false)
    }
  }

  const discard = () => {
    setItems(buildInitialItems(storedMenu))
  }

  // What the public header will show, in order: enabled links whose feature
  // is on (custom links are always shown when enabled).
  const previewItems = items.filter((item) => {
    if (!item.enabled) return false
    if (item.type === 'custom') return true
    const { planAllowed, featureEnabled } = featureState(item.type)
    return planAllowed && featureEnabled
  })

  return (
    <>
      <div className="flex flex-col gap-5">
        {!canEdit && (
          <Notice tone="amber" icon={<ShieldWarning size={16} />}>
            {t('dashboard.organization.features.toasts.admin_only')}
          </Notice>
        )}

        <SectionCard
          icon={<ListIcon size={18} />}
          title={t('dashboard.organization.menu.title')}
          description={t('dashboard.organization.menu.subtitle')}
          bodyClassName="px-5 pb-5 pt-4"
        >
          {/* Live strip of the public navigation. */}
          <div className="mb-4 flex items-center gap-1.5 overflow-x-auto rounded-xl bg-neutral-50 px-3 py-2.5 ring-1 ring-inset ring-neutral-200/70 scrollbar-hide">
            <span className="me-2 shrink-0 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
              {t('dashboard.organization.settings_ui.menu.preview')}
            </span>
            {previewItems.length === 0 ? (
              <span className="text-xs text-neutral-400">{t('dashboard.organization.settings_ui.menu.preview_empty')}</span>
            ) : (
              previewItems.map((item, i) => {
                const meta = BUILTIN_META[item.type]
                const Icon = meta?.Icon || menuIcon(item.icon)
                return (
                  <span
                    key={`${item.type}-${i}`}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-white px-2.5 py-1 text-xs font-semibold text-neutral-700 shadow-[0_1px_2px_rgba(0,0,0,0.06),0_0_0_1px_rgba(0,0,0,0.05)]"
                  >
                    <Icon size={13} weight="fill" className="text-neutral-500" />
                    {item.label || defaultLabel(item.type, t) || item.url}
                  </span>
                )
              })
            )}
          </div>

          <DragDropContext onDragEnd={onDragEnd}>
            <Droppable droppableId="menu-items">
              {(provided) => (
                <div
                  ref={provided.innerRef}
                  {...provided.droppableProps}
                  className="rounded-xl ring-1 ring-inset ring-neutral-200/80 divide-y divide-neutral-100 overflow-hidden"
                >
                  {items.map((item, index) => {
                    const meta = BUILTIN_META[item.type]
                    const { requiredPlan, planAllowed, featureEnabled } = featureState(item.type)
                    const isCustom = item.type === 'custom'
                    const Icon = meta?.Icon || menuIcon(item.icon)
                    // Gray out built-in links whose feature is plan-locked or turned off.
                    const grayed = !isCustom && (!planAllowed || !featureEnabled)
                    const toggleDisabled = !canEdit || grayed
                    return (
                      <Draggable key={`${item.type}-${index}`} draggableId={`${item.type}-${index}`} index={index}>
                        {(prov, snap) => (
                          <div
                            ref={prov.innerRef}
                            {...prov.draggableProps}
                            className={`flex items-center gap-3 bg-white px-3 py-2.5 ${snap.isDragging ? 'shadow-lg ring-1 ring-neutral-200 rounded-xl' : ''}`}
                          >
                            <button
                              type="button"
                              {...prov.dragHandleProps}
                              className="text-neutral-300 hover:text-neutral-500 cursor-grab active:cursor-grabbing"
                              aria-label={t('dashboard.organization.menu.reorder')}
                            >
                              <DotsSixVertical size={18} weight="bold" />
                            </button>
                            <div className={`flex flex-1 min-w-0 items-center gap-3 ${grayed ? 'opacity-55 grayscale' : ''}`}>
                              {isCustom ? (
                                <IconPicker
                                  value={item.icon}
                                  onChange={(name) => setItem(index, { icon: name })}
                                  disabled={!canEdit}
                                />
                              ) : (
                                <div className="w-9 h-9 bg-neutral-100 rounded-lg flex items-center justify-center flex-shrink-0">
                                  <Icon size={18} weight="fill" className="text-neutral-600" />
                                </div>
                              )}
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <input
                                    type="text"
                                    value={item.label || ''}
                                    placeholder={isCustom ? t('dashboard.organization.menu.label_placeholder') : defaultLabel(item.type, t)}
                                    onChange={(e) => setItem(index, { label: e.target.value })}
                                    disabled={!canEdit}
                                    aria-label={t('dashboard.organization.menu.label_placeholder')}
                                    className="text-sm font-semibold text-neutral-900 placeholder:text-neutral-700 bg-transparent rounded-md px-1.5 -ms-1.5 py-0.5 w-48 max-w-full hover:bg-neutral-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-neutral-900/10"
                                  />
                                  {requiredPlan && (
                                    <PlanBadge currentPlan={currentPlan} requiredPlan={requiredPlan as PlanLevel} />
                                  )}
                                </div>
                                {isCustom ? (
                                  <input
                                    type="text"
                                    value={item.url || ''}
                                    placeholder="https://"
                                    onChange={(e) => setItem(index, { url: e.target.value })}
                                    disabled={!canEdit}
                                    data-ltr-content
                                    className="text-xs text-neutral-500 bg-transparent rounded-md px-1.5 -ms-1.5 py-0.5 w-full hover:bg-neutral-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-neutral-900/10"
                                  />
                                ) : (
                                  <p className="text-xs text-neutral-400 truncate">
                                    <span data-ltr-content>{meta?.link}</span>
                                    {!planAllowed && requiredPlan && (
                                      <span className="text-amber-600 inline-flex items-center gap-1 ms-2"><Lock size={10} />{t('dashboard.organization.menu.plan_locked', { plan: requiredPlan })}</span>
                                    )}
                                    {planAllowed && !featureEnabled && (
                                      <span className="text-neutral-400 ms-2">· {t('dashboard.organization.menu.feature_off')}</span>
                                    )}
                                  </p>
                                )}
                              </div>
                            </div>
                            {isCustom && (
                              <Button
                                variant="danger-ghost"
                                size="icon"
                                onClick={() => removeItem(index)}
                                disabled={!canEdit}
                                aria-label={t('dashboard.organization.menu.remove')}
                                title={t('dashboard.organization.menu.remove')}
                                icon={<Trash size={14} />}
                              />
                            )}
                            <Switch
                              checked={item.enabled && (isCustom || planAllowed)}
                              onCheckedChange={(v) => setItem(index, { enabled: v })}
                              disabled={toggleDisabled}
                              aria-label={item.label || defaultLabel(item.type, t) || item.url}
                            />
                          </div>
                        )}
                      </Draggable>
                    )
                  })}
                  {provided.placeholder}
                </div>
              )}
            </Droppable>
          </DragDropContext>
        </SectionCard>

        <SectionCard
          icon={<LinkSimple size={18} />}
          title={t('dashboard.organization.menu.add_custom')}
          description={t('dashboard.organization.settings_ui.menu.add_desc')}
        >
          <form
            className="flex flex-col sm:flex-row sm:items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              addCustom()
            }}
          >
            <IconPicker value={newIcon} onChange={setNewIcon} disabled={!canEdit} />
            <input
              type="text"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder={t('dashboard.organization.menu.label_placeholder')}
              disabled={!canEdit}
              className={`${INPUT} sm:!w-56`}
            />
            <input
              type="text"
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              placeholder="https://example.com"
              disabled={!canEdit}
              data-ltr-content
              className={`${INPUT} flex-1`}
            />
            <Button type="submit" disabled={!canEdit} icon={<Plus size={14} />}>
              {t('dashboard.organization.menu.add')}
            </Button>
          </form>
        </SectionCard>
      </div>

      <StickySaveBar visible={dirty || saving} saving={saving} onSave={save} onDiscard={discard} disabled={!canEdit} />
    </>
  )
}

export default OrgEditMenu
