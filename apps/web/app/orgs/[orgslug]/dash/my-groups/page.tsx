'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import useAdminStatus from '@components/Hooks/useAdminStatus'
import MyGroupsPage from '@components/Pages/Groups/MyGroupsPage'

/** Staff see My groups inside the dashboard shell; members without dashboard
 *  access are sent to the learner-side page (same view, learner frame). */
export default function Page() {
  const { isAdmin } = useAdminStatus() as any
  const router = useRouter()
  useEffect(() => {
    if (isAdmin === false) router.replace(`/groups${window.location.search}`)
  }, [isAdmin, router])
  if (isAdmin !== true) return null
  return <MyGroupsPage frame="dash" />
}
