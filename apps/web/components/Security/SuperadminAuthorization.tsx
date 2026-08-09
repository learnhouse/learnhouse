'use client'
import React, { useEffect, useState, useCallback, useMemo } from 'react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useRouter } from 'next/navigation'
import PageLoading from '@components/Objects/Loaders/PageLoading'

type SuperadminAuthorizationProps = {
  children: React.ReactNode
}

const SuperadminAuthorization: React.FC<SuperadminAuthorizationProps> = ({
  children,
}) => {
  const session = useLHSession() as any
  const router = useRouter()
  const [isAuthorized, setIsAuthorized] = useState(false)
  const [isChecking, setIsChecking] = useState(true)
  const [isRedirecting, setIsRedirecting] = useState(false)

  const isUserAuthenticated = useMemo(
    () => session.status === 'authenticated',
    [session.status]
  )

  const checkAuth = useCallback(() => {
    if (session.status === 'loading') return

    if (!isUserAuthenticated) {
      // Keep the loader up through the navigation rather than releasing it
      // into a false "Access Denied" flash.
      setIsRedirecting(true)
      router.push('/admin/login')
      return
    }

    setIsAuthorized(session?.data?.user?.is_superadmin === true)
    setIsChecking(false)
  }, [session.status, isUserAuthenticated, session?.data?.user?.is_superadmin, router])

  useEffect(() => {
    checkAuth()
  }, [checkAuth])

  if (session.status === 'loading' || isChecking || isRedirecting) {
    return (
      <div className="flex justify-center items-center h-screen">
        <PageLoading />
      </div>
    )
  }

  // No deployment-mode check here. app/admin/layout.tsx resolves the mode
  // server-side and renders the licence screen before this component mounts.
  // The previous check ran on a client-side value and failed closed, which
  // could hide the dashboard from legitimate operators during a transient
  // backend failure. Two gates with opposite failure directions is worse
  // than one.
  if (!isAuthorized) {
    return (
      <div className="flex justify-center items-center h-screen bg-[#0f0f10]">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-white mb-2">Access Denied</h1>
          <p className="text-white/50">
            You need superadmin privileges to access this page.
          </p>
        </div>
      </div>
    )
  }

  return <>{children}</>
}

export default SuperadminAuthorization
