'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { EnvelopeSimple, Eye, PaperPlaneTilt } from '@phosphor-icons/react'
import { Button, ConfirmDialog, FieldLabel, INPUT, Modal, SegmentedControl, TEXTAREA } from '@/design'
import { errorMessage } from '@services/ee/platform/api'
import { EMAIL_CATEGORIES, emailOrg, listTemplates, opsKeys, type EmailCategory, type OrgEmailBody } from '@services/ee/platform/ops'
import { useAccessToken, shouldRetry } from '@components/Admin/hooks'

// "Email admins": pick a template or write one, preview the rendered email
// (server-side render, shown in a sandboxed frame), then send after a confirm.

type Preview = { subject: string; html?: string; recipients: string[] | number }

function recipientCount(r: string[] | number | undefined): number {
  return Array.isArray(r) ? r.length : typeof r === 'number' ? r : 0
}

export default function EmailAdminsDialog({ open, onOpenChange, org }: { open: boolean; onOpenChange: (_open: boolean) => void; org: { id: number; name: string } }) {
  const { t } = useTranslation()
  const token = useAccessToken()
  const [mode, setMode] = React.useState<'template' | 'write'>('write')
  const [templateUuid, setTemplateUuid] = React.useState('')
  const [subject, setSubject] = React.useState('')
  const [body, setBody] = React.useState('')
  const [category, setCategory] = React.useState<EmailCategory>('transactional')
  const [recipients, setRecipients] = React.useState<'admins' | 'owners'>('admins')
  const [preview, setPreview] = React.useState<Preview | null>(null)
  const [previewing, setPreviewing] = React.useState(false)
  const [confirm, setConfirm] = React.useState(false)
  const [error, setError] = React.useState('')

  const templatesQ = useQuery({ queryKey: opsKeys.templates(), queryFn: () => listTemplates(token), enabled: open && !!token, retry: shouldRetry })
  const templates = Array.isArray(templatesQ.data) ? templatesQ.data : []

  React.useEffect(() => {
    if (!open) return
    setMode('write')
    setTemplateUuid('')
    setSubject('')
    setBody('')
    setCategory('transactional')
    setRecipients('admins')
    setPreview(null)
    setError('')
  }, [open])

  // Any edit makes the old preview stale; send needs a fresh one.
  React.useEffect(() => setPreview(null), [mode, templateUuid, subject, body, category, recipients])

  const payload = (isPreview: boolean): OrgEmailBody => ({
    ...(mode === 'template' ? { template_uuid: templateUuid } : { subject: subject.trim(), body }),
    category,
    recipients,
    preview: isPreview,
  })
  const ready = mode === 'template' ? !!templateUuid : !!subject.trim() && !!body.trim()

  const doPreview = async () => {
    setPreviewing(true)
    setError('')
    try {
      setPreview(await emailOrg(token, org.id, payload(true)))
    } catch (err) {
      setError(errorMessage(err, t('admin.common.error_desc')))
    } finally {
      setPreviewing(false)
    }
  }
  const send = async () => {
    try {
      const res = await emailOrg(token, org.id, payload(false))
      toast.success(t('admin.org.email.sent', { count: res.sent ?? recipientCount(res.recipients) }))
      onOpenChange(false)
    } catch (err) {
      toast.error(errorMessage(err, t('admin.common.error_desc')))
    }
  }

  const count = recipientCount(preview?.recipients)

  return (
    <>
      <Modal
        isDialogOpen={open}
        onOpenChange={onOpenChange}
        size="lg"
        icon={<EnvelopeSimple size={16} />}
        dialogTitle={t('admin.org.email.title', { name: org.name })}
        dialogDescription={t('admin.org.email.desc')}
        footer={
          <div className="flex flex-wrap items-center justify-end gap-2">
            {preview && <span className="me-auto text-xs text-neutral-500">{t('admin.org.email.recipients', { count })}</span>}
            <Button onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
            <Button icon={<Eye size={14} />} onClick={doPreview} disabled={!ready} loading={previewing}>
              {t('admin.org.email.preview')}
            </Button>
            <Button variant="primary" icon={<PaperPlaneTilt size={14} />} disabled={!preview || count === 0} onClick={() => setConfirm(true)}>
              {t('admin.org.email.send')}
            </Button>
          </div>
        }
        dialogContent={
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <SegmentedControl
                value={mode}
                onChange={setMode}
                ariaLabel={t('admin.org.email.source')}
                options={[
                  { key: 'write', label: t('admin.org.email.write') },
                  { key: 'template', label: t('admin.org.email.template') },
                ]}
              />
              <SegmentedControl
                value={recipients}
                onChange={setRecipients}
                ariaLabel={t('admin.org.email.to')}
                options={[
                  { key: 'admins', label: t('admin.org.email.to_admins') },
                  { key: 'owners', label: t('admin.org.email.to_owner') },
                ]}
              />
            </div>
            {mode === 'template' ? (
              <div>
                <FieldLabel hint={templates.length ? undefined : t('admin.org.email.no_templates')}>{t('admin.org.email.template')}</FieldLabel>
                <select value={templateUuid} onChange={(e) => setTemplateUuid(e.target.value)} className={INPUT}>
                  <option value="">{t('admin.org.email.pick_template')}</option>
                  {templates.map((tpl) => (
                    <option key={tpl.template_uuid} value={tpl.template_uuid}>
                      {tpl.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <>
                <div>
                  <FieldLabel>{t('admin.org.email.subject')}</FieldLabel>
                  <input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} className={INPUT} />
                </div>
                <div>
                  <FieldLabel hint={t('admin.org.email.body_hint', { org_name: '{{org_name}}' })}>{t('admin.org.email.body')}</FieldLabel>
                  <textarea rows={6} value={body} onChange={(e) => setBody(e.target.value)} className={TEXTAREA} placeholder={t('admin.org.email.body_placeholder', { admin_name: '{{admin_name}}' })} />
                </div>
              </>
            )}
            <div>
              <FieldLabel hint={t('admin.org.email.category_hint')}>{t('admin.org.email.category')}</FieldLabel>
              <select value={category} onChange={(e) => setCategory(e.target.value as EmailCategory)} className={INPUT}>
                {EMAIL_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {t(`admin.org.email.cat_${c}`)}
                  </option>
                ))}
              </select>
            </div>
            {error && <p className="text-sm text-rose-600">{error}</p>}
            {preview && (
              <div className="space-y-2">
                <p className="text-sm">
                  <span className="text-neutral-500">{t('admin.org.email.subject')}: </span>
                  <span className="font-semibold text-neutral-900">{preview.subject}</span>
                </p>
                {preview.html && (
                  // Server-rendered email HTML, isolated: no scripts, no same-origin access.
                  // Emails are designed on white, so the frame stays white in both themes.
                  <iframe
                    title={t('admin.org.email.preview')}
                    sandbox=""
                    srcDoc={preview.html}
                    style={{ background: 'white' }}
                    className="w-full h-72 rounded-xl ring-1 ring-inset ring-neutral-200"
                  />
                )}
              </div>
            )}
          </div>
        }
      />
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        tone="info"
        title={t('admin.org.email.confirm_title', { count })}
        message={t('admin.org.email.confirm_desc', { name: org.name, count })}
        confirmLabel={t('admin.org.email.send')}
        onConfirm={send}
      />
    </>
  )
}
