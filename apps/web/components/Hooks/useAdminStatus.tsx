import { useOrg } from '@components/Contexts/OrgContext'
import { useSession } from 'next-auth/react'
import { useEffect } from 'react'

function useAdminStatus() {
    const session = useSession() as any
    const org = useOrg() as any
    console.log('useAdminStatus', {
        session,
    })

    // If session is not loaded, redirect to login

    useEffect(() => {
        if (session.status == 'loading') {
            return
        }

    }
        , [session])

    const isUserAdmin = () => {
        if (session.status == 'authenticated') {
            const isAdmin = session?.data?.roles.some((role: any) => {
                return (
                    role.org.id === org.id &&
                    (role.role.id === 1 ||
                        role.role.id === 2 ||
                        role.role.role_uuid === 'role_global_admin' ||
                        role.role.role_uuid === 'role_global_maintainer')
                )
            })
            return isAdmin
        }
        return false
    }

    // Return the user admin status
    return isUserAdmin()

}

export default useAdminStatus