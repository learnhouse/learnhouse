'use client'
import React from 'react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'

interface AuthenticatedClientElementProps {
  children: React.ReactNode
  checkMethod: 'authentication' | 'roles'
  orgId?: string | number
  ressourceType?:
  | 'folders'
  | 'media'
  | 'courses'
  | 'activities'
  | 'users'
  | 'organizations'
  | 'communities'
  | 'discussions'
  | 'podcasts'
  | 'boards'
  | 'playgrounds'
  action?: 'create' | 'update' | 'delete' | 'read'
}

function isUserAllowed(
  roles: any[],
  action: string,
  resourceType: string,
  org_uuid: string
): boolean {
  if (!Array.isArray(roles)) {
    return false
  }

  for (const role of roles) {
    // Check if the role is for the right organization
    if (role.org.org_uuid === org_uuid) {
      // Check if the user has the role for the resource type
      if (role.role.rights && role.role.rights[resourceType]) {
        // Check if the user is allowed to execute the action
        const actionKey = `action_${action}`
        if (role.role.rights[resourceType][actionKey] === true) {
          return true
        }
      }
    }
  }

  // If no role matches the organization, resource type, and action, return false
  return false
}

export const AuthenticatedClientElement = (
  props: AuthenticatedClientElementProps
) => {
  const session = useLHSession() as any
  const org = useOrg() as any

  // Derived during render rather than in an effect: same result, without a
  // second render for every instance once the session resolves.
  const status = session?.status
  const sessionData = session?.data
  const orgUuid = org?.org_uuid
  const { checkMethod, action, ressourceType } = props
  const isAllowed = React.useMemo(() => {
    if (status === 'loading' || status === 'unauthenticated') {
      return false
    }
    if (checkMethod === 'authentication') {
      return status === 'authenticated'
    }
    if (checkMethod === 'roles') {
      // Superadmins bypass all role checks
      if (sessionData?.user?.is_superadmin === true) {
        return true
      }
      return isUserAllowed(sessionData?.roles, action!, ressourceType!, orgUuid)
    }
    return false
  }, [status, sessionData, orgUuid, checkMethod, action, ressourceType])

  return <>{isAllowed && props.children}</>
}

export default AuthenticatedClientElement
