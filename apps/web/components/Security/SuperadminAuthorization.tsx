'use client'
import React, { useEffect, useState, useCallback, useMemo } from 'react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useRouter } from 'next/navigation'
import PageLoading from '@components/Objects/Loaders/PageLoading'
import { getDeploymentMode } from '@services/config/config'

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

  const isUserAuthenticated = useMemo(
    () => session.status === 'authenticated',
    [session.status]
  )

  const checkAuth = useCallback(() => {
    if (session.status === 'loading') return

    if (!isUserAuthenticated) {
      router.push('/login')
      return
    }

    const isSuperadmin = session?.data?.user?.is_superadmin === true
    if (isSuperadmin) {
      setIsAuthorized(true)
    } else {
      setIsAuthorized(false)
    }
    setIsChecking(false)
  }, [session.status, isUserAuthenticated, session?.data?.user?.is_superadmin, router])

  useEffect(() => {
    checkAuth()
  }, [checkAuth])

  if (session.status === 'loading' || isChecking) {
    return (
      <div className="flex justify-center items-center h-screen">
        <PageLoading />
      </div>
    )
  }

  if (getDeploymentMode() === 'oss') {
    return (
      <div className="flex justify-center items-center h-screen bg-[#0f0f10]">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-white mb-2">Not Available in OSS Mode</h1>
          <p className="text-white/50">
            The superadmin dashboard is not available in OSS deployments.
          </p>
        </div>
      </div>
    )
  }

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
