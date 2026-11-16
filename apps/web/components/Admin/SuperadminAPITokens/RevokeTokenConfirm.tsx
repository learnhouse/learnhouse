'use client'
import React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Trans, useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import { ConfirmDialog } from '@/design'
import { errorMessage, revokeToken } from '@services/ee/platform/api'
import { platformKeys } from '@services/ee/platform/keys'
import type { SuperadminToken } from '@services/ee/platform/types'
import { useAccessToken } from '@components/Admin/hooks'

export default function RevokeTokenConfirm({ token, onClose }: { token: SuperadminToken | null; onClose: () => void }) {
  const { t } = useTranslation()
  const accessToken = useAccessToken()
  const queryClient = useQueryClient()
  // Keep the last token around while the dialog animates out.
  const [shown, setShown] = React.useState<SuperadminToken | null>(token)
  React.useEffect(() => {
    if (token) setShown(token)
  }, [token])

  return (
    <ConfirmDialog
      open={!!token}
      onOpenChange={(o) => !o && onClose()}
      title={t('admin.tokens.revoke_title')}
      message={
        <>
          <Trans i18nKey="admin.tokens.revoke_body" values={{ name: shown?.name ?? '' }} components={{ strong: <strong className="text-neutral-900" /> }} />{' '}
          {t('admin.tokens.cannot_undo')}
        </>
      }
      confirmLabel={t('admin.tokens.revoke_token')}
      onConfirm={async () => {
        if (!token) return
        try {
          await revokeToken(accessToken, token.token_uuid)
          queryClient.invalidateQueries({ queryKey: platformKeys.tokens() })
          toast.success(t('admin.tokens.revoked'))
        } catch (e) {
          toast.error(errorMessage(e, t('admin.tokens.failed_revoke', { status: (e as any)?.status ?? '' })))
        }
      }}
    />
  )
}
