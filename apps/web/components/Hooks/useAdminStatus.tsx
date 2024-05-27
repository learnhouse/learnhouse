import { useOrg } from '@components/Contexts/OrgContext';
import { useLHSession } from '@components/Contexts/LHSessionContext';
import { useEffect, useState, useMemo } from 'react';

interface Role {
    org: { id: number };
    role: { id: number; role_uuid: string };
}

function useAdminStatus() {
    const session = useLHSession() as any;
    const org = useOrg() as any;
    const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
    const [loading, setLoading] = useState<boolean>(true);

    const userRoles = useMemo(() => session?.data?.roles || [], [session?.data?.roles]);

    useEffect(() => {
        if (session.status === 'authenticated' && org?.id) {
            const isAdminVar = userRoles.some((role: Role) => {
                return (
                    role.org.id === org.id &&
                    (role.role.id === 1 ||
                        role.role.id === 2 ||
                        role.role.role_uuid === 'role_global_admin' ||
                        role.role.role_uuid === 'role_global_maintainer')
                );
            });
            setIsAdmin(isAdminVar);
            setLoading(false); // Set loading to false once the status is determined
        } else {
            setIsAdmin(false);
            setLoading(false); // Set loading to false if not authenticated or org not found
        }
    }, [session.status, userRoles, org.id]);

    return { isAdmin, loading };
}

export default useAdminStatus;
