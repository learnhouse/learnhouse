'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { MessagesSquare } from 'lucide-react'
import { fmtDate } from '../format'
import { Card, SectionTitle, Empty, P } from './primitives'

export default function CommunitySection({ community }: { community: any }) {
  const { t } = useTranslation()
  const discussions = community?.discussions || []
  const comments = community?.comments || []
  return (
    <Card>
      <SectionTitle icon={<MessagesSquare size={18} />} title={t(`${P}.community.title`)} count={discussions.length + comments.length} />
      {discussions.length === 0 && comments.length === 0 ? (
        <Empty label={t(`${P}.community.empty`)} />
      ) : (
        <div className="space-y-4">
          {discussions.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-gray-400 uppercase mb-2">{t(`${P}.community.discussions`)}</div>
              <div className="space-y-2">
                {discussions.map((d: any, i: number) => (
                  <div key={i} className="flex items-center justify-between gap-3 text-sm border border-gray-100 rounded p-2">
                    <div className="min-w-0">
                      <div className="truncate">{d.title}</div>
                      {d.community_name && (
                        <div className="text-xs text-gray-400 truncate">{d.community_name}</div>
                      )}
                    </div>
                    <span className="text-xs text-gray-400 flex-shrink-0">{fmtDate(d.created_at)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {comments.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-gray-400 uppercase mb-2">{t(`${P}.community.comments`)}</div>
              <div className="space-y-2">
                {comments.map((c: any, i: number) => (
                  <div key={i} className="flex items-start justify-between gap-3 text-sm border border-gray-100 rounded p-2">
                    <div className="min-w-0">
                      {/* A comment out of context reads as noise; the thread title is
                          what makes it an audit record. */}
                      {c.discussion_title && (
                        <div className="text-xs text-gray-400 truncate">
                          {t(`${P}.community.in_discussion`, {
                            title: c.discussion_title,
                            defaultValue: 'In "{{title}}"',
                          })}
                        </div>
                      )}
                      <div className="text-gray-600 line-clamp-2">{c.content}</div>
                    </div>
                    <span className="text-xs text-gray-400 flex-shrink-0">{fmtDate(c.created_at)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  )
}
