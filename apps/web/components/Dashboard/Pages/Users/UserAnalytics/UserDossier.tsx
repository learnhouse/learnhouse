'use client'
import React, { useState } from 'react'
import UserAvatar from '@components/Objects/UserAvatar'
import { Badge } from '@components/ui/badge'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@components/ui/tabs'
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from '@components/ui/table'
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts'
import {
  Activity, Award, BookOpen, Clock, Code2, LogIn, MessagesSquare,
  ShieldCheck, TrendingUp, Info, ChevronDown, ChevronRight, Globe, Monitor,
} from 'lucide-react'
import { fmtDate, fmtDateTime, fmtDuration, fullName, avatarUrl } from './format'
import UserAuditExport from './UserAuditExport'

// ---------------------------------------------------------------------------
// Small presentational primitives (no external card/progress component exists)
// ---------------------------------------------------------------------------
function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-white rounded-xl nice-shadow p-5 ${className}`}>{children}</div>
  )
}

function SectionTitle({ icon, title, count }: { icon: React.ReactNode; title: string; count?: number }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <span className="text-gray-500">{icon}</span>
      <h3 className="font-bold text-lg tracking-tight">{title}</h3>
      {count !== undefined && (
        <span className="text-xs font-semibold text-gray-400 bg-gray-100 rounded-full px-2 py-0.5">{count}</span>
      )}
    </div>
  )
}

function KpiTile({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: React.ReactNode; sub?: string }) {
  return (
    <Card className="flex flex-col gap-1">
      <div className="flex items-center gap-2 text-gray-400">
        {icon}
        <span className="text-xs font-semibold uppercase tracking-wide">{label}</span>
      </div>
      <div className="text-2xl font-bold tracking-tight">{value}</div>
      {sub && <div className="text-xs text-gray-400">{sub}</div>}
    </Card>
  )
}

function ProgressBar({ pct }: { pct: number }) {
  const clamped = Math.max(0, Math.min(100, pct || 0))
  return (
    <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
      <div
        className="h-full bg-gradient-to-r from-blue-400 to-blue-600 rounded-full transition-all"
        style={{ width: `${clamped}%` }}
      />
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    STATUS_COMPLETED: 'bg-green-100 text-green-700',
    STATUS_IN_PROGRESS: 'bg-blue-100 text-blue-700',
    STATUS_PAUSED: 'bg-amber-100 text-amber-700',
    STATUS_CANCELLED: 'bg-gray-100 text-gray-600',
    GRADED: 'bg-green-100 text-green-700',
    SUBMITTED: 'bg-blue-100 text-blue-700',
    PENDING: 'bg-amber-100 text-amber-700',
    LATE: 'bg-red-100 text-red-700',
    NOT_SUBMITTED: 'bg-gray-100 text-gray-600',
  }
  const label = status?.replace('STATUS_', '').replace('_', ' ').toLowerCase()
  return (
    <span className={`text-xs font-semibold rounded-full px-2 py-0.5 capitalize ${map[status] || 'bg-gray-100 text-gray-600'}`}>
      {label || '—'}
    </span>
  )
}

function Empty({ label }: { label: string }) {
  return <div className="text-sm text-gray-400 py-8 text-center">{label}</div>
}

// ---------------------------------------------------------------------------
// Section: Connections timeline
// ---------------------------------------------------------------------------
function ConnectionsSection({ connections }: { connections: any[] }) {
  return (
    <Card>
      <SectionTitle icon={<LogIn size={18} />} title="Connections" count={connections.length} />
      {connections.length === 0 ? (
        <Empty label="No recorded connections yet." />
      ) : (
        <ol className="relative border-l border-gray-200 ml-2">
          {connections.map((c, i) => (
            <li key={i} className="mb-5 ml-5">
              <span className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full bg-blue-500 border-2 border-white" />
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-sm capitalize">{c.event_type}</span>
                {c.metadata?.method && <Badge variant="secondary">{c.metadata.method}</Badge>}
                <span className="text-xs text-gray-400">{fmtDateTime(c.at)}</span>
              </div>
              <div className="flex flex-wrap gap-4 mt-1 text-xs text-gray-500">
                {c.ip && <span className="flex items-center gap-1"><Globe size={12} /> {c.ip}</span>}
                {c.user_agent && (
                  <span className="flex items-center gap-1 max-w-md truncate" title={c.user_agent}>
                    <Monitor size={12} /> {c.user_agent}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Section: Course progress
// ---------------------------------------------------------------------------
function CoursesSection({ courses }: { courses: any[] }) {
  return (
    <Card>
      <SectionTitle icon={<BookOpen size={18} />} title="Course progress" count={courses.length} />
      {courses.length === 0 ? (
        <Empty label="Not enrolled in any course." />
      ) : (
        <div className="space-y-4">
          {courses.map((c, i) => (
            <div key={i} className="border border-gray-100 rounded-lg p-4">
              <div className="flex items-center justify-between gap-3 mb-2">
                <span className="font-semibold truncate">{c.course_name || c.course_uuid}</span>
                <StatusBadge status={c.status} />
              </div>
              <ProgressBar pct={c.progress_pct} />
              <div className="flex flex-wrap justify-between gap-3 mt-2 text-xs text-gray-500">
                <span>{c.progress_pct}% · {c.activities_completed}/{c.activities_total} activities</span>
                <span>Enrolled {fmtDate(c.enrolled_at)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Section: Assignments (with per-task expand)
// ---------------------------------------------------------------------------
function AssignmentRow({ a }: { a: any }) {
  const [open, setOpen] = useState(false)
  const hasTasks = (a.tasks || []).length > 0
  return (
    <div className="border border-gray-100 rounded-lg">
      <button
        type="button"
        onClick={() => hasTasks && setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-3 p-4 text-left"
      >
        <div className="flex items-center gap-2 min-w-0">
          {hasTasks ? (open ? <ChevronDown size={16} /> : <ChevronRight size={16} />) : <span className="w-4" />}
          <span className="font-semibold truncate">{a.title || a.assignment_uuid}</span>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <span className="text-sm font-semibold">
            {a.grade != null ? `${a.grade}/${a.max_grade_value ?? 100}` : '—'}
          </span>
          <span className="text-xs text-gray-400">attempt {a.attempt_number}</span>
          <StatusBadge status={a.status} />
        </div>
      </button>
      {open && hasTasks && (
        <div className="px-4 pb-4 space-y-2">
          {a.overall_feedback && (
            <div className="text-xs text-gray-600 bg-gray-50 rounded p-2">
              <span className="font-semibold">Feedback: </span>{a.overall_feedback}
            </div>
          )}
          {a.tasks.map((tk: any, i: number) => (
            <div key={i} className="text-xs border border-gray-100 rounded p-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold">{tk.assignment_type?.replace('TASK_TYPE_', '')}</span>
                <span>{tk.grade} pts {tk.manually_graded ? '· manual' : ''}</span>
              </div>
              {tk.feedback && <div className="text-gray-500 mt-1">{tk.feedback}</div>}
              <pre className="text-[11px] text-gray-500 mt-1 whitespace-pre-wrap break-words max-h-40 overflow-auto">
                {JSON.stringify(tk.answer, null, 2)}
              </pre>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function AssignmentsSection({ assignments }: { assignments: any[] }) {
  return (
    <Card>
      <SectionTitle icon={<Activity size={18} />} title="Assignments" count={assignments.length} />
      {assignments.length === 0 ? (
        <Empty label="No assignment submissions." />
      ) : (
        <div className="space-y-3">
          {assignments.map((a, i) => <AssignmentRow key={i} a={a} />)}
        </div>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Section: Code submissions
// ---------------------------------------------------------------------------
function CodeSection({ submissions }: { submissions: any[] }) {
  return (
    <Card>
      <SectionTitle icon={<Code2 size={18} />} title="Code exercises" count={submissions.length} />
      {submissions.length === 0 ? (
        <Empty label="No code submissions." />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Activity</TableHead>
              <TableHead>Result</TableHead>
              <TableHead>Tests</TableHead>
              <TableHead>Time</TableHead>
              <TableHead>When</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {submissions.map((s, i) => (
              <TableRow key={i}>
                <TableCell className="font-mono text-xs truncate max-w-[140px]">{s.activity_uuid}</TableCell>
                <TableCell>
                  <span className={s.passed ? 'text-green-600' : 'text-red-600'}>
                    {s.passed ? 'Passed' : 'Failed'}
                  </span>
                </TableCell>
                <TableCell>{s.passed_tests}/{s.total_tests}</TableCell>
                <TableCell>{s.execution_time_ms != null ? `${s.execution_time_ms}ms` : '—'}</TableCell>
                <TableCell className="text-xs text-gray-500">{fmtDateTime(s.created_at)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Section: Community
// ---------------------------------------------------------------------------
function CommunitySection({ community }: { community: any }) {
  const discussions = community?.discussions || []
  const comments = community?.comments || []
  return (
    <Card>
      <SectionTitle icon={<MessagesSquare size={18} />} title="Community participation" count={discussions.length + comments.length} />
      {discussions.length === 0 && comments.length === 0 ? (
        <Empty label="No community activity." />
      ) : (
        <div className="space-y-4">
          {discussions.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-gray-400 uppercase mb-2">Discussions</div>
              <div className="space-y-2">
                {discussions.map((d: any, i: number) => (
                  <div key={i} className="flex items-center justify-between text-sm border border-gray-100 rounded p-2">
                    <span className="truncate">{d.title}</span>
                    <span className="text-xs text-gray-400">{fmtDate(d.created_at)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {comments.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-gray-400 uppercase mb-2">Comments</div>
              <div className="space-y-2">
                {comments.map((c: any, i: number) => (
                  <div key={i} className="flex items-center justify-between gap-3 text-sm border border-gray-100 rounded p-2">
                    <span className="truncate text-gray-600">{c.content}</span>
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

// ---------------------------------------------------------------------------
// Section: Certificates
// ---------------------------------------------------------------------------
function CertificatesSection({ certificates }: { certificates: any[] }) {
  return (
    <Card>
      <SectionTitle icon={<Award size={18} />} title="Certificates earned" count={certificates.length} />
      {certificates.length === 0 ? (
        <Empty label="No certificates earned." />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {certificates.map((c, i) => (
            <div key={i} className="flex items-center gap-3 border border-gray-100 rounded-lg p-3">
              <Award size={20} className="text-amber-500 flex-shrink-0" />
              <div className="min-w-0">
                <div className="font-semibold truncate">{c.course_name}</div>
                <div className="text-xs text-gray-400">{fmtDate(c.created_at)} · {c.user_certification_uuid}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Section: Behavior (Tinybird enrichment)
// ---------------------------------------------------------------------------
function BehaviorSection({ behavior }: { behavior: any }) {
  const daily = (behavior?.user_daily_activity || []).map((d: any) => ({
    day: d.day, events: Number(d.events || 0), minutes: Math.round(Number(d.seconds || 0) / 60),
  }))
  const searches = behavior?.user_searches || []
  const byCourse = behavior?.user_time_by_course || []
  const hasAny = daily.length > 0 || searches.length > 0 || byCourse.length > 0

  return (
    <Card>
      <SectionTitle icon={<TrendingUp size={18} />} title="Behavioral analytics" />
      {!hasAny ? (
        <Empty label="No behavioral data (analytics may be unconfigured for this window)." />
      ) : (
        <div className="space-y-6">
          {daily.length > 0 && (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={daily} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="ua-grad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Area type="monotone" dataKey="minutes" name="minutes" stroke="#3b82f6" fill="url(#ua-grad)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
          {byCourse.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-gray-400 uppercase mb-2">Time spent by course</div>
              <div className="space-y-1">
                {byCourse.map((c: any, i: number) => (
                  <div key={i} className="flex items-center justify-between text-sm">
                    <span className="font-mono text-xs truncate">{c.course_uuid}</span>
                    <span>{fmtDuration(c.total_seconds)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {searches.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-gray-400 uppercase mb-2">Searches</div>
              <div className="flex flex-wrap gap-2">
                {searches.map((s: any, i: number) => (
                  <Badge key={i} variant="secondary">{s.query} · {s.count}</Badge>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Main dossier
// ---------------------------------------------------------------------------
export default function UserDossier({ dossier }: { dossier: any }) {
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
                <ShieldCheck size={12} /> {security.email_verified ? 'Verified' : 'Unverified'}
              </span>
              {security.signup_method && <span className="text-gray-400">via {security.signup_method}</span>}
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
        <KpiTile icon={<BookOpen size={14} />} label="Courses" value={summary.courses_enrolled ?? 0} sub={`${summary.courses_completed ?? 0} completed`} />
        <KpiTile icon={<TrendingUp size={14} />} label="Avg progress" value={`${summary.avg_progress_pct ?? 0}%`} />
        <KpiTile icon={<Clock size={14} />} label="Time spent" value={fmtDuration(totalSeconds)} />
        <KpiTile icon={<Activity size={14} />} label="Assignments" value={summary.assignments_submitted ?? 0} sub={summary.avg_grade != null ? `avg ${summary.avg_grade}` : undefined} />
        <KpiTile icon={<Award size={14} />} label="Certificates" value={summary.certificates_earned ?? 0} />
        <KpiTile icon={<LogIn size={14} />} label="Connections" value={summary.connections ?? 0} sub={summary.last_connection ? `last ${fmtDate(summary.last_connection)}` : undefined} />
      </div>

      {/* Detailed sections */}
      <Tabs defaultValue="connections">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="connections">Connections</TabsTrigger>
          <TabsTrigger value="courses">Courses</TabsTrigger>
          <TabsTrigger value="assignments">Assignments</TabsTrigger>
          <TabsTrigger value="code">Code</TabsTrigger>
          <TabsTrigger value="community">Community</TabsTrigger>
          <TabsTrigger value="certificates">Certificates</TabsTrigger>
          <TabsTrigger value="behavior">Behavior</TabsTrigger>
        </TabsList>
        <TabsContent value="connections"><ConnectionsSection connections={dossier?.connections || []} /></TabsContent>
        <TabsContent value="courses"><CoursesSection courses={dossier?.courses || []} /></TabsContent>
        <TabsContent value="assignments"><AssignmentsSection assignments={dossier?.assignments || []} /></TabsContent>
        <TabsContent value="code"><CodeSection submissions={dossier?.code_submissions || []} /></TabsContent>
        <TabsContent value="community"><CommunitySection community={dossier?.community || {}} /></TabsContent>
        <TabsContent value="certificates"><CertificatesSection certificates={dossier?.certificates || []} /></TabsContent>
        <TabsContent value="behavior"><BehaviorSection behavior={behavior} /></TabsContent>
      </Tabs>

      {/* Coverage notes */}
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
