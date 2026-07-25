'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog, DialogContent } from '@components/ui/dialog'
import { useUserDossier } from './useUserAudit'
import UserDossier from './UserDossier'
import LearnHouseSpinner from '@components/Objects/Loaders/LearnHouseSpinner'

interface Props {
  userId: number | null
  days?: number
  onOpenChange: (_open: boolean) => void
}

export default function UserDossierModal({ userId, days = 365, onOpenChange }: Props) {
  const { t } = useTranslation()
  const { data, isLoading, isError } = useUserDossier(userId, days)

  return (
    <Dialog open={userId != null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto bg-[#f8f8f8] p-6 sm:p-8">
        {isLoading && (
          <div className="py-20 flex justify-center"><LearnHouseSpinner /></div>
        )}
        {isError && (
          <div className="py-20 text-center text-sm text-gray-500">{t('dashboard.users.analytics.failed_load')}</div>
        )}
        {data && !isLoading && <UserDossier dossier={data} />}
      </DialogContent>
    </Dialog>
  )
}
