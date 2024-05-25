'use client'
import { useOrg } from '@components/Contexts/OrgContext'
import { useSession } from 'next-auth/react'
import useAdminStatus from '@components/Hooks/useAdminStatus'
import { usePathname, useRouter } from 'next/navigation'
import React from 'react'

type AuthorizationProps = {
  children: React.ReactNode
  // Authorize components rendering or page rendering
  authorizationMode: 'component' | 'page'
}

const ADMIN_PATHS = [
  '/dash/org/*',
  '/dash/org',
  '/dash/users/*',
  '/dash/users',
  '/dash/courses/*',
  '/dash/courses',
  '/dash/org/settings/general',
]

function AdminAuthorization(props: AuthorizationProps) {
  const session = useSession() as any
  const org = useOrg() as any
  const pathname = usePathname()
  const router = useRouter()

  // States
  const [isLoading, setIsLoading] = React.useState(true)
  const [isAuthorized, setIsAuthorized] = React.useState(false)

  // Verify if the user is authenticated
  const isUserAuthenticated = () => {
    if (session.status === 'authenticated') {
      return true
    } else {
      return false
    }
  }

  // Verify if the user is an Admin (1), Maintainer (2) or Member (3) of the organization
  const isUserAdmin = useAdminStatus()

  function checkPathname(pattern: string, pathname: string) {
    // Escape special characters in the pattern and replace '*' with a regex pattern
    const regexPattern = new RegExp(
      `^${pattern.replace(/\//g, '\\/').replace(/\*/g, '.*')}$`
    )

    // Test if the pathname matches the regex pattern
    const isMatch = regexPattern.test(pathname)

    return isMatch
  }

  const Authorize = () => {
    if (props.authorizationMode === 'page') {
      // Check if user is in an admin path
      if (ADMIN_PATHS.some((path) => checkPathname(path, pathname))) {
        if (isUserAuthenticated()) {
          // Check if the user is an Admin
          if (isUserAdmin) {
            setIsAuthorized(true)
          } else {
            setIsAuthorized(false)
            router.push('/dash')
          }
        } else {
          router.push('/login')
        }
      } else {
        if (isUserAuthenticated()) {
          setIsAuthorized(true)
        } else {
          setIsAuthorized(false)
          router.push('/login')
        }
      }
    }

    if (props.authorizationMode === 'component') {
      // Component mode
      if (isUserAuthenticated() && isUserAdmin) {
        setIsAuthorized(true)
      } else {
        setIsAuthorized(false)
      }
    }
  }

  React.useEffect(() => {
    if (session.status == 'loading') {
      return
    }

    Authorize()
    setIsLoading(false)
  }, [session, org, pathname])

  return (
    <>
      {props.authorizationMode === 'component' &&
        isAuthorized === true &&
        props.children}
      {props.authorizationMode === 'page' &&
        isAuthorized === true &&
        !isLoading &&
        props.children}
      {props.authorizationMode === 'page' &&
        isAuthorized === false &&
        !isLoading && (
          <div className="flex justify-center items-center h-screen">
            <h1 className="text-2xl">
              You are not authorized to access this page
            </h1>
          </div>
        )}
    </>
  )
}

export default AdminAuthorization
