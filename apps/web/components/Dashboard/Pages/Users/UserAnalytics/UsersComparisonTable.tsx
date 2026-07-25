'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from '@components/ui/table'
import UserAvatar from '@components/Objects/UserAvatar'
import { useUsersAuditSummary } from './useUserAudit'
import { fullName, fmtDate, avatarUrl } from './format'
import LearnHouseSpinner from '@components/Objects/Loaders/LearnHouseSpinner'
import { Eye } from 'lucide-react'

interface Props {
  userIds: number[]
  days?: number
  onOpenUser: (_userId: number) => void
}

export default function UsersComparisonTable({ userIds, days = 365, onOpenUser }: Props) {
  const { t } = useTranslation()
  const { data, isLoading } = useUsersAuditSummary(userIds, days)
  const rows = data?.data || []
  const P = 'dashboard.users.analytics.comparison'

  if (isLoading) {
    return <div className="py-16 flex justify-center"><LearnHouseSpinner /></div>
  }

  return (
    <div className="bg-white rounded-xl nice-shadow overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t(`${P}.student`)}</TableHead>
            <TableHead className="text-center">{t(`${P}.enrolled`)}</TableHead>
            <TableHead className="text-center">{t(`${P}.completed`)}</TableHead>
            <TableHead className="text-center">{t(`${P}.certificates`)}</TableHead>
            <TableHead>{t(`${P}.last_connection`)}</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r: any) => (
            <TableRow key={r.user.id}>
              <TableCell>
                <div className="flex items-center gap-2 min-w-0">
                  <UserAvatar
                    width={30}
                    rounded="rounded-lg"
                    avatar_url={avatarUrl(r.user)}
                    userId={String(r.user.id)}
                    username={r.user.username}
                    predefined_avatar={avatarUrl(r.user) ? undefined : 'empty'}
                  />
                  <div className="min-w-0">
                    <div className="font-semibold text-sm truncate">{fullName(r.user)}</div>
                    <div className="text-xs text-gray-400 truncate">{r.user.email}</div>
                  </div>
                </div>
              </TableCell>
              <TableCell className="text-center">{r.courses_enrolled}</TableCell>
              <TableCell className="text-center">{r.courses_completed}</TableCell>
              <TableCell className="text-center">{r.certificates_earned}</TableCell>
              <TableCell className="text-xs text-gray-500">{fmtDate(r.last_connection)}</TableCell>
              <TableCell>
                <button
                  onClick={() => onOpenUser(r.user.id)}
                  className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700"
                >
                  <Eye size={13} /> {t(`${P}.view`)}
                </button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
