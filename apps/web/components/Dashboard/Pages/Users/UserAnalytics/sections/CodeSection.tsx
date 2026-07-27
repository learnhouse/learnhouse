'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { Code2 } from 'lucide-react'
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from '@components/ui/table'
import { fmtDateTime } from '../format'
import { Card, SectionTitle, Empty, P } from './primitives'

export default function CodeSection({ submissions }: { submissions: any[] }) {
  const { t } = useTranslation()
  return (
    <Card>
      <SectionTitle icon={<Code2 size={18} />} title={t(`${P}.code.title`)} count={submissions.length} />
      {submissions.length === 0 ? (
        <Empty label={t(`${P}.code.empty`)} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t(`${P}.code.activity`)}</TableHead>
              <TableHead>{t(`${P}.code.language`, { defaultValue: 'Language' })}</TableHead>
              <TableHead>{t(`${P}.code.result`)}</TableHead>
              <TableHead>{t(`${P}.code.tests`)}</TableHead>
              <TableHead>{t(`${P}.code.time`)}</TableHead>
              <TableHead>{t(`${P}.code.when`)}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {submissions.map((s, i) => (
              <TableRow key={i}>
                <TableCell className="max-w-[220px]">
                  <div className="truncate font-medium">
                    {s.activity_name || t(`${P}.code.untitled_activity`, { defaultValue: 'Untitled activity' })}
                  </div>
                  {s.course_name && (
                    <div className="truncate text-xs text-gray-400">{s.course_name}</div>
                  )}
                </TableCell>
                <TableCell className="text-xs">{s.language || '—'}</TableCell>
                <TableCell>
                  <span className={s.passed ? 'text-green-600' : 'text-red-600'}>
                    {s.passed ? t(`${P}.code.passed`) : t(`${P}.code.failed`)}
                  </span>
                </TableCell>
                <TableCell>{s.tests_summary || `${s.passed_tests}/${s.total_tests}`}</TableCell>
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
