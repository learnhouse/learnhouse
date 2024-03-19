import { useOrg } from '@components/Contexts/OrgContext'
import { useSession } from '@components/Contexts/SessionContext'
import { useEffect } from 'react'

function useAdminStatus() {
    const session = useSession() as any
    const org = useOrg() as any

    // If session is not loaded, redirect to login
 
    useEffect(() => {
        if (session.isLoading) {
            return
        }
        
    }
    , [session])

    const isUserAdmin = () => {
        if (session.isAuthenticated) {
            const isAdmin = session.roles.some((role: any) => {
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