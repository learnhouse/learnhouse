'use client'

import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { Buildings, Megaphone, SpinnerGap, Users } from '@phosphor-icons/react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@components/ui/dialog'
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg p-0 overflow-hidden">
        <DialogHeader className="px-5 py-4 border-b border-gray-100 space-y-0">
          <DialogTitle className="text-xl font-semibold text-gray-900">
            {t('messaging.announce', { defaultValue: 'Message everyone in a course' })}
          </DialogTitle>
          <DialogDescription className="text-sm text-gray-500">
            {t('messaging.announce_desc', {
              defaultValue: 'Every enrolled learner gets it in their Messages. They can react, but replies stay private.',
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="px-5 pt-4 max-h-[236px] overflow-y-auto space-y-1.5">
          {targets.map((x) => {
            const active = target?.course_uuid === x.course_uuid
            return (
              <button
                key={x.course_uuid ?? 'org'}
                onClick={() => setTarget(x)}
                className={`w-full flex items-center gap-3 rounded-lg border px-3 py-2.5 text-start transition-colors ${
                  active ? 'border-gray-900 bg-gray-50' : 'border-gray-200 hover:bg-gray-50'
                }`}
              >
                {x.course_uuid ? (
                  <CourseThumb course={x as any} size={36} />
                ) : (
                  <span className="h-9 w-9 rounded-lg bg-gray-100 text-gray-600 flex items-center justify-center">
                    <Buildings size={18} weight="fill" />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{x.name}</p>
                  <p className="text-xs text-gray-500 flex items-center gap-1">
                    <Users size={12} />
                    {x.course_uuid
                      ? t('messaging.learners_count', { defaultValue: '{{count}} learners', count: x.learners })
                      : t('messaging.members_count', { defaultValue: '{{count}} members', count: x.learners })}
                  </p>
                </div>
              </button>
            )
          })}
        </div>

        <div className="px-5 pt-4">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={4}
            maxLength={4000}
            autoFocus
            placeholder={t('messaging.announce_placeholder', { defaultValue: 'Write your announcement…' })}
            className="w-full resize-none rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-gray-200"
          />
          {target?.course_uuid && (
            <label className="mt-2 flex items-center justify-between gap-3 text-sm text-gray-600">
              <span>{t('messaging.attach_course', { defaultValue: 'Attach the course card' })}</span>
              <Switch checked={shareCourse} onCheckedChange={setShareCourse} />
            </label>
          )}
        </div>

        {error && <p className="px-5 pt-2 text-xs text-red-600">{error}</p>}

        <div className="mt-4 flex items-center justify-between gap-3 border-t border-gray-100 px-5 py-3">
          <span className="text-xs text-gray-500">
            {sentTo !== null
              ? t('messaging.sent_to', { defaultValue: 'Sent to {{count}} people', count: sentTo })
              : target
                ? t('messaging.will_reach', { defaultValue: 'Reaches {{count}} people', count: target.learners })
                : ''}
          </span>
          <button
            disabled={!target || !content.trim() || busy || sentTo !== null}
            onClick={submit}
            className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40 hover:bg-gray-800"
          >
            {busy ? <SpinnerGap size={14} className="animate-spin" /> : <Megaphone size={14} weight="fill" />}
            {t('messaging.send_announcement', { defaultValue: 'Send announcement' })}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
