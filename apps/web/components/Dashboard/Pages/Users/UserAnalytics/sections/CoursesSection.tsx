'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { BookOpen } from 'lucide-react'
import { fmtDate } from '../format'
import { Card, SectionTitle, ProgressBar, StatusBadge, Empty, P } from './primitives'

export default function CoursesSection({ courses }: { courses: any[] }) {
  const { t } = useTranslation()
  return (
    <Card>
      <SectionTitle icon={<BookOpen size={18} />} title={t(`${P}.courses.title`)} count={courses.length} />
      {courses.length === 0 ? (
        <Empty label={t(`${P}.courses.empty`)} />
      ) : (
        <div className="space-y-4">
          {courses.map((c, i) => (
            <div key={i} className="border border-gray-100 rounded-lg p-4">
              <div className="flex items-center justify-between gap-3 mb-2">
                <span className="font-semibold truncate">
                  {c.course_name || t(`${P}.behavior.untitled_course`, { defaultValue: 'Untitled course' })}
                </span>
                <StatusBadge status={c.status} />
              </div>
              <ProgressBar pct={c.progress_pct} />
              <div className="flex flex-wrap justify-between gap-3 mt-2 text-xs text-gray-500">
                <span>{c.progress_pct}% · {t(`${P}.courses.activities`, { done: c.activities_completed, total: c.activities_total })}</span>
                <span>{t(`${P}.courses.enrolled`, { date: fmtDate(c.enrolled_at) })}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}
