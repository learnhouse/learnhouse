'use client'

import React from 'react'
import { useTranslation } from 'react-i18next'
import GeneralWrapperStyled from '@components/Objects/StyledElements/Wrappers/GeneralWrapper'
import NotificationsCenter from '@components/Notifications/NotificationsCenter'
import { useNotificationSession } from '@components/Notifications/useNotificationSession'
import { getUriWithOrg } from '@services/config/config'

export default function NotificationsPageClient() {
  const { t } = useTranslation()
  const { signedIn, orgslug } = useNotificationSession()
  return (
    <GeneralWrapperStyled>
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 pb-16 pt-2 md:pt-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-neutral-900">{t('notifications.title')}</h1>
          <p className="mt-1 text-sm text-neutral-500">{t('notifications.page_subtitle')}</p>
        </div>
        {signedIn ? (
          <NotificationsCenter audience="personal" />
        ) : (
          <p className="text-sm text-neutral-500">
            <a className="font-semibold underline" href={getUriWithOrg(orgslug, '/login?redirect=/notifications')}>
              {t('notifications.sign_in')}
            </a>
          </p>
        )}
      </div>
    </GeneralWrapperStyled>
  )
}
