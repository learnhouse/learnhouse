'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { BUILT_IN_ROLES, type RoleOption } from '@services/organizations/invitations'

// Role names and plain-language descriptions in the reader's language: the
// four built-in roles from the locales, custom roles as their admins wrote them.
// Kept apart from the invitation kit so public pages (the invite link) stay light.
export function useRoleText() {
  const { t } = useTranslation()
  return React.useCallback(
    (role: RoleOption | { role_uuid: string; name: string; description?: string | null }) => {
      const kind = BUILT_IN_ROLES[role.role_uuid]
      if (kind) {
        return {
          name: t(`dashboard.users.invitations.roles.${kind}.name`),
          description: t(`dashboard.users.invitations.roles.${kind}.description`),
        }
      }
      return { name: role.name, description: role.description || t('dashboard.users.invitations.roles.custom_description') }
    },
    [t]
  )
}
