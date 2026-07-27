'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import UserAvatar from '@components/Objects/UserAvatar'
import { Badge } from '@components/ui/badge'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@components/ui/tabs'
import {
  Activity, Award, BookOpen, Clock, LogIn, ShieldCheck, TrendingUp, Info,
} from 'lucide-react'
import { fmtDate, fmtDuration, fullName, avatarUrl } from './format'
import UserAuditExport from './UserAuditExport'
import { Card, KpiTile, P } from './sections/primitives'
import ConnectionsSection from './sections/ConnectionsSection'
import CoursesSection from './sections/CoursesSection'
import AssignmentsSection from './sections/AssignmentsSection'
import CodeSection from './sections/CodeSection'
import CommunitySection from './sections/CommunitySection'
import CertificatesSection from './sections/CertificatesSection'
import BehaviorSection from './sections/BehaviorSection'

export default function UserDossier({ dossier }: { dossier: any }) {
  const { t } = useTranslation()
  const user = dossier?.user || {}
  const summary = dossier?.summary || {}
  const security = dossier?.security || {}
  const membership = dossier?.membership || {}
  const behavior = dossier?.behavior || {}
  const totalSeconds = Number(behavior?.user_time_total?.[0]?.total_seconds || 0)

  return (
    <div className="space-y-6">
      {/* Identity header */}
      <Card className="flex flex-col sm:flex-row sm:items-center gap-4 justify-between">
        <div className="flex items-center gap-4 min-w-0">
          <UserAvatar
            width={64}
            rounded="rounded-xl"
            avatar_url={avatarUrl(user)}
            userId={String(user.id ?? '')}
            username={user.username}
            predefined_avatar={avatarUrl(user) ? undefined : 'empty'}
          />
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="font-bold text-xl tracking-tight truncate">{fullName(user)}</h2>
              {membership.role && <Badge variant="secondary">{membership.role}</Badge>}
            </div>
            <div className="text-sm text-gray-500 truncate">@{user.username} · {user.email}</div>
            <div className="flex flex-wrap gap-2 mt-2 text-xs">
              <span className={`flex items-center gap-1 ${security.email_verified ? 'text-green-600' : 'text-amber-600'}`}>
                <ShieldCheck size={12} /> {security.email_verified ? t(`${P}.identity.verified`) : t(`${P}.identity.unverified`)}
              </span>
              {security.signup_method && <span className="text-gray-400">{t(`${P}.identity.via`, { method: security.signup_method })}</span>}
              {(membership.groups || []).map((g: string, i: number) => (
                <Badge key={i} variant="outline">{g}</Badge>
              ))}
            </div>
          </div>
        </div>
        <UserAuditExport userIds={[user.id]} defaultDossier={dossier} />
      </Card>

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <KpiTile icon={<BookOpen size={14} />} label={t(`${P}.kpi.courses`)} value={summary.courses_enrolled ?? 0} sub={t(`${P}.kpi.completed`, { count: summary.courses_completed ?? 0 })} />
        <KpiTile icon={<TrendingUp size={14} />} label={t(`${P}.kpi.avg_progress`)} value={`${summary.avg_progress_pct ?? 0}%`} />
        <KpiTile icon={<Clock size={14} />} label={t(`${P}.kpi.time_spent`)} value={fmtDuration(totalSeconds)} />
        <KpiTile icon={<Activity size={14} />} label={t(`${P}.kpi.assignments`)} value={summary.assignments_submitted ?? 0} sub={summary.avg_grade_pct != null ? t(`${P}.kpi.avg_grade`, { grade: `${summary.avg_grade_pct}%` }) : undefined} />
        <KpiTile icon={<Award size={14} />} label={t(`${P}.kpi.certificates`)} value={summary.certificates_earned ?? 0} />
        <KpiTile icon={<LogIn size={14} />} label={t(`${P}.kpi.connections`)} value={summary.connections ?? 0} sub={summary.last_connection ? t(`${P}.kpi.last`, { date: fmtDate(summary.last_connection) }) : undefined} />
      </div>

      {/* Detailed sections */}
      <Tabs defaultValue="connections">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="connections">{t(`${P}.tabs.connections`)}</TabsTrigger>
          <TabsTrigger value="courses">{t(`${P}.tabs.courses`)}</TabsTrigger>
          <TabsTrigger value="assignments">{t(`${P}.tabs.assignments`)}</TabsTrigger>
          <TabsTrigger value="code">{t(`${P}.tabs.code`)}</TabsTrigger>
          <TabsTrigger value="community">{t(`${P}.tabs.community`)}</TabsTrigger>
          <TabsTrigger value="certificates">{t(`${P}.tabs.certificates`)}</TabsTrigger>
          <TabsTrigger value="behavior">{t(`${P}.tabs.behavior`)}</TabsTrigger>
        </TabsList>
        <TabsContent value="connections"><ConnectionsSection connections={dossier?.connections || []} /></TabsContent>
        <TabsContent value="courses"><CoursesSection courses={dossier?.courses || []} /></TabsContent>
        <TabsContent value="assignments"><AssignmentsSection assignments={dossier?.assignments || []} /></TabsContent>
        <TabsContent value="code"><CodeSection submissions={dossier?.code_submissions || []} /></TabsContent>
        <TabsContent value="community"><CommunitySection community={dossier?.community || {}} /></TabsContent>
        <TabsContent value="certificates"><CertificatesSection certificates={dossier?.certificates || []} /></TabsContent>
        <TabsContent value="behavior"><BehaviorSection behavior={behavior} /></TabsContent>
      </Tabs>

      {/* Coverage notes (server-provided, rendered as-is) */}
      {(dossier?.coverage_notes || []).length > 0 && (
        <div className="flex gap-2 text-xs text-gray-400 bg-gray-50 rounded-lg p-4">
          <Info size={14} className="flex-shrink-0 mt-0.5" />
          <ul className="space-y-1 list-disc list-inside">
            {dossier.coverage_notes.map((n: string, i: number) => <li key={i}>{n}</li>)}
          </ul>
        </div>
      )}
    </div>
  )
}
