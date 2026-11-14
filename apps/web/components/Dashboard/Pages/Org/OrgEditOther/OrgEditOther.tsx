'use client'
import React from 'react'
import { updateOrganization } from '@services/settings/org'
import { revalidateTags } from '@services/utils/ts/requests'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { toast } from 'react-hot-toast'
import { Switch } from '@components/ui/switch'
import { Code, Plus, Trash, PencilSimple, Warning, Stamp, FileCode } from '@phosphor-icons/react'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { getAPIUrl, getDeploymentMode, getTenancy } from '@services/config/config'
import { usePlan } from '@components/Hooks/usePlan'
import { useTranslation } from 'react-i18next'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import {
  Button,
  ConfirmDialog,
  EmptyState,
  FieldLabel,
  INPUT,
  SectionCard,
  SettingRow,
  TEXTAREA,
} from '@components/Dashboard/Shared/DashKit/DashKit'
import { Notice } from '@components/Dashboard/Pages/Org/OrgSettingsShared/orgSettingsUi'

interface Script {
  name: string
  content: string
}

const OrgEditOther: React.FC = () => {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const org = useOrg() as any
  const queryClient = useQueryClient()
  const plan = usePlan()
  const isFree = plan === 'free'
  const isEE = getDeploymentMode() === 'ee'
  // Matches lib/orgScripts: on a multi-tenant deployment scripts only run on
  // the org's custom domain.
  const isMultiTenant = getTenancy() === 'multi'
  const [scripts, setScripts] = React.useState<Script[]>([])
  // null: editor closed; { script: null }: adding; { script }: editing that one.
  const [editing, setEditing] = React.useState<{ script: Script | null } | null>(null)
  const [form, setForm] = React.useState<Script>({ name: '', content: '' })
  const [formErrors, setFormErrors] = React.useState<{ name?: string; content?: string }>({})
  const [savingScript, setSavingScript] = React.useState(false)
  const [deleteTarget, setDeleteTarget] = React.useState<Script | null>(null)

  // Watermark state
  const [watermarkEnabled, setWatermarkEnabled] = React.useState<boolean>(
    (org?.config?.config?.customization?.general?.watermark ?? org?.config?.config?.general?.watermark) !== false
  )
  const [isWatermarkSaving, setIsWatermarkSaving] = React.useState(false)

  const updateWatermark = async (enabled: boolean) => {
    if (isFree && !enabled) {
      toast.error(t('dashboard.organization.settings.watermark_free_plan'))
      return
    }
    setIsWatermarkSaving(true)
    setWatermarkEnabled(enabled)
    const loadingToast = toast.loading(t('dashboard.organization.settings.updating'))
    try {
      const response = await fetch(`${getAPIUrl()}orgs/${org.id}/config/watermark?watermark_enabled=${enabled}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${access_token}`,
        },
      })
      if (!response.ok) throw new Error('Failed to update watermark')
      await revalidateTags(['organizations'], org.slug)
      queryClient.invalidateQueries({ queryKey: queryKeys.org.detail(org.slug) })
      toast.success(t('dashboard.organization.settings.update_success'), { id: loadingToast })
    } catch {
      setWatermarkEnabled(!enabled)
      toast.error(t('dashboard.organization.settings.update_error'), { id: loadingToast })
    } finally {
      setIsWatermarkSaving(false)
    }
  }

  // Initialize scripts from org
  React.useEffect(() => {
    const list = org?.scripts?.scripts
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setScripts(Array.isArray(list) ? list : [])
  }, [org])

  const persistScripts = async (updatedScripts: Script[]) => {
    await updateOrganization(org.id, { id: org.id, scripts: { scripts: updatedScripts } }, access_token)
    await revalidateTags(['organizations'], org.slug)
    queryClient.invalidateQueries({ queryKey: queryKeys.org.detail(org.slug) })
    setScripts(updatedScripts)
  }

  const openEditor = (script: Script | null) => {
    setForm(script ? { ...script } : { name: '', content: '' })
    setFormErrors({})
    setEditing({ script })
  }

  const saveScript = async () => {
    const errors: { name?: string; content?: string } = {}
    if (!form.name.trim()) errors.name = t('dashboard.organization.scripts.script_name') + ' is required'
    if (!form.content.trim()) errors.content = t('dashboard.organization.scripts.script_content') + ' is required'
    setFormErrors(errors)
    if (Object.keys(errors).length) return

    const current = editing?.script ?? null
    const updatedScripts = current
      ? scripts.map((script) => (script.name === current.name ? form : script))
      : [...scripts, form]
    setSavingScript(true)
    const loadingToast = toast.loading(t('dashboard.organization.settings.updating'))
    try {
      await persistScripts(updatedScripts)
      setEditing(null)
      toast.success(t('dashboard.organization.scripts.toasts.save_success'), { id: loadingToast })
    } catch (err) {
      console.error('Error updating organization:', err)
      toast.error(t('dashboard.organization.settings.update_error'), { id: loadingToast })
    } finally {
      setSavingScript(false)
    }
  }

  const deleteScript = async (scriptToDelete: Script) => {
    const loadingToast = toast.loading(t('dashboard.organization.settings.updating'))
    try {
      await persistScripts(scripts.filter((script) => script.name !== scriptToDelete.name))
      toast.success(t('dashboard.organization.scripts.toasts.delete_success'), { id: loadingToast })
    } catch (err) {
      console.error('Error deleting script:', err)
      toast.error(t('dashboard.organization.settings.update_error'), { id: loadingToast })
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <SectionCard
        icon={<Stamp size={18} />}
        title={t('dashboard.organization.settings_ui.other.branding_title')}
        description={t('dashboard.organization.settings_ui.other.branding_desc')}
      >
        <SettingRow
          title={<label htmlFor="watermark" className="cursor-pointer">{t('dashboard.organization.settings.watermark_label')}</label>}
          description={
            isEE
              ? t('dashboard.organization.settings.watermark_ee')
              : isFree
                ? t('dashboard.organization.settings.watermark_free_plan')
                : t('dashboard.organization.settings.watermark_desc')
          }
          control={
            <Switch
              id="watermark"
              checked={isEE ? false : watermarkEnabled}
              onCheckedChange={updateWatermark}
              disabled={isWatermarkSaving || isFree || isEE}
            />
          }
        />
      </SectionCard>

      <SectionCard
        icon={<Code size={18} />}
        title={t('dashboard.organization.scripts.title')}
        description={t('dashboard.organization.scripts.subtitle')}
        actions={
          scripts.length > 0 ? (
            <Button variant="primary" icon={<Plus size={14} />} onClick={() => openEditor(null)}>
              {t('dashboard.organization.scripts.add_script')}
            </Button>
          ) : undefined
        }
      >
        <div className="flex flex-col gap-4">
          <Notice tone="amber" icon={<Warning size={16} />}>
            <p>{t('dashboard.organization.scripts.warning')}</p>
            {isMultiTenant && <p className="mt-1 font-medium">{t('dashboard.organization.scripts.custom_domain_only')}</p>}
          </Notice>

          {scripts.length === 0 ? (
            <div className="rounded-xl ring-1 ring-inset ring-neutral-200/70">
              <EmptyState
                icon={<FileCode size={22} />}
                title={t('dashboard.organization.scripts.no_scripts')}
                description={t('dashboard.organization.scripts.add_first_script')}
                action={
                  <Button variant="primary" icon={<Plus size={14} />} onClick={() => openEditor(null)}>
                    {t('dashboard.organization.scripts.add_script')}
                  </Button>
                }
              />
            </div>
          ) : (
            <ul className="rounded-xl ring-1 ring-inset ring-neutral-200/70 divide-y divide-neutral-100">
              {scripts.map((script, index) => (
                <li key={index} className="group flex items-start gap-3 px-4 py-3">
                  <span className="mt-0.5 w-8 h-8 shrink-0 rounded-lg bg-neutral-100 text-neutral-500 flex items-center justify-center">
                    <FileCode size={16} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-neutral-900 truncate">{script.name}</p>
                    <pre
                      data-ltr-content
                      className="mt-1 text-xs text-neutral-500 font-mono truncate"
                    >
                      {script.content.length > 100 ? script.content.substring(0, 100) + '...' : script.content}
                    </pre>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t('dashboard.organization.settings_ui.other.edit_script')}
                      title={t('dashboard.organization.settings_ui.other.edit_script')}
                      onClick={() => openEditor(script)}
                      icon={<PencilSimple size={14} />}
                    />
                    <Button
                      variant="danger-ghost"
                      size="icon"
                      aria-label={t('common.delete', { defaultValue: 'Delete' })}
                      title={t('common.delete', { defaultValue: 'Delete' })}
                      onClick={() => setDeleteTarget(script)}
                      icon={<Trash size={14} />}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </SectionCard>

      <Modal
        isDialogOpen={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        preventClose={savingScript}
        size="lg"
        icon={<Code size={16} />}
        dialogTitle={editing?.script ? editing.script.name : t('dashboard.organization.scripts.add_script')}
        dialogContent={
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              saveScript()
            }}
          >
            <label className="block">
              <FieldLabel error={formErrors.name}>{t('dashboard.organization.scripts.script_name')}</FieldLabel>
              <input
                id="name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder={t('dashboard.organization.scripts.placeholders.name')}
                className={INPUT}
                autoFocus
              />
            </label>
            <label className="block">
              <FieldLabel error={formErrors.content}>{t('dashboard.organization.scripts.script_content')}</FieldLabel>
              <textarea
                id="content"
                value={form.content}
                onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
                placeholder={t('dashboard.organization.scripts.placeholders.content')}
                rows={12}
                data-ltr-content
                className={`${TEXTAREA} font-mono text-xs`}
              />
            </label>
          </form>
        }
        footer={
          <>
            <Button onClick={() => setEditing(null)} disabled={savingScript}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" onClick={saveScript} loading={savingScript}>
              {t('dashboard.organization.scripts.save_script')}
            </Button>
          </>
        }
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={t('dashboard.organization.settings_ui.other.delete_script_title')}
        message={deleteTarget?.name}
        confirmLabel={t('common.delete', { defaultValue: 'Delete' })}
        onConfirm={() => (deleteTarget ? deleteScript(deleteTarget) : undefined)}
      />
    </div>
  )
}

export default OrgEditOther
