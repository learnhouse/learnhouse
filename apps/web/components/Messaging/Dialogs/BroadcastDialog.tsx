'use client'

import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { Buildings, CheckCircle, Megaphone, Users } from '@phosphor-icons/react'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import { Button, FieldLabel, TEXTAREA } from '@components/Dashboard/Shared/DashKit/DashKit'
import { Switch } from '@components/ui/switch'
import { messagingKeys, useMessaging } from '@components/Messaging/MessagingProvider'
import { useBroadcastTargets } from '@components/Messaging/hooks'
import { CourseThumb } from '@components/Messaging/ui/Avatars'
import { BroadcastTarget, Conversation, sendBroadcast } from '@services/messaging/messaging'

export default function BroadcastDialog({
  open,
  onOpenChange,
  onSent,
  initialCourseUuid,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSent?: (conversation: Conversation) => void
  initialCourseUuid?: string | null
}) {
  const { t } = useTranslation()
  const { orgId, token } = useMessaging()
  const qc = useQueryClient()
  const { data: targets = [] } = useBroadcastTargets()
  const [target, setTarget] = useState<BroadcastTarget | null>(null)
  const [content, setContent] = useState('')
  const [shareCourse, setShareCourse] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sentTo, setSentTo] = useState<number | null>(null)

  useEffect(() => {
    if (!open) {
      setContent('')
      setError('')
      setSentTo(null)
      return
    }
    if (!target && targets.length) {
      setTarget(targets.find((x) => x.course_uuid === initialCourseUuid) || targets.find((x) => x.course_uuid) || targets[0])
    }
  }, [open, targets, initialCourseUuid, target])

  const submit = async () => {
    if (!target || !content.trim() || !orgId || !token) return
    setBusy(true)
    setError('')
    try {
      const res = await sendBroadcast(
        { org_id: orgId, course_uuid: target.course_uuid, content: content.trim(), share_course: Boolean(target.course_uuid && shareCourse) },
        token
      )
      qc.invalidateQueries({ queryKey: messagingKeys.conversations(orgId) })
      setSentTo(res.recipients)
      setTimeout(() => {
        onSent?.(res.conversation)
        onOpenChange(false)
      }, 900)
    } catch (e: any) {
      setError(e?.message || 'Could not send')
    } finally {
      setBusy(false)
    }
  }

  const body = (
    <div className="flex flex-col gap-4">
      <div>
        <FieldLabel>{t('messaging.send_to', { defaultValue: 'Send to' })}</FieldLabel>
        <div className="-mx-1 max-h-[236px] space-y-1 overflow-y-auto px-1 py-0.5" role="radiogroup">
          {targets.map((x) => {
            const active = target?.course_uuid === x.course_uuid
            return (
              <button
                key={x.course_uuid ?? 'org'}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setTarget(x)}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-start transition-all ${
                  active ? 'bg-white ring-2 ring-neutral-900' : 'bg-white ring-1 ring-inset ring-neutral-200 hover:ring-neutral-300'
                }`}
              >
                {x.course_uuid ? (
                  <CourseThumb course={x as any} size={36} />
                ) : (
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-neutral-100 text-neutral-600">
                    <Buildings size={18} weight="fill" />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-neutral-900">{x.name}</p>
                  <p className="flex items-center gap-1 text-xs text-neutral-500">
                    <Users size={12} />
                    {x.course_uuid
                      ? t('messaging.learners_count', { defaultValue: '{{count}} learners', count: x.learners })
                      : t('messaging.members_count', { defaultValue: '{{count}} members', count: x.learners })}
                  </p>
                </div>
                <span className={`h-4 w-4 shrink-0 rounded-full ${active ? 'border-[5px] border-neutral-900' : 'ring-1 ring-inset ring-neutral-300'}`} />
              </button>
            )
          })}
        </div>
      </div>

      <div>
        <FieldLabel hint={`${content.length}/4000`}>{t('messaging.message_label', { defaultValue: 'Message' })}</FieldLabel>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={4}
          maxLength={4000}
          autoFocus
          placeholder={t('messaging.announce_placeholder', { defaultValue: 'Write your announcement…' })}
          className={TEXTAREA}
        />
        {target?.course_uuid && (
          <label className="mt-3 flex items-center justify-between gap-3 text-sm text-neutral-700">
            <span>{t('messaging.attach_course', { defaultValue: 'Attach the course card' })}</span>
            <Switch checked={shareCourse} onCheckedChange={setShareCourse} />
          </label>
        )}
      </div>

      {error && <p className="text-xs font-medium text-rose-600">{error}</p>}
    </div>
  )

  return (
    <Modal
      isDialogOpen={open}
      onOpenChange={onOpenChange}
      size="md"
      preventClose={busy}
      icon={<Megaphone size={16} weight="fill" />}
      dialogTitle={t('messaging.announce', { defaultValue: 'Message everyone in a course' })}
      dialogDescription={t('messaging.announce_desc', {
        defaultValue: 'Every enrolled learner gets it in their Messages. They can react, but replies stay private.',
      })}
      dialogContent={body}
      footer={
        <>
          <span className={`me-auto inline-flex items-center gap-1.5 text-xs ${sentTo !== null ? 'font-medium text-emerald-700' : 'text-neutral-500'}`}>
            {sentTo !== null && <CheckCircle size={14} weight="fill" />}
            {sentTo !== null
              ? t('messaging.sent_to', { defaultValue: 'Sent to {{count}} people', count: sentTo })
              : target
                ? t('messaging.will_reach', { defaultValue: 'Reaches {{count}} people', count: target.learners })
                : ''}
          </span>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
            {t('common.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!target || !content.trim() || sentTo !== null}
            icon={<Megaphone size={14} weight="fill" />}
            onClick={submit}
          >
            {t('messaging.send_announcement', { defaultValue: 'Send announcement' })}
          </Button>
        </>
      }
    />
  )
}
