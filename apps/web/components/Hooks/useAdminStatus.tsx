import { useOrg } from '@components/Contexts/OrgContext';
import { useLHSession } from '@components/Contexts/LHSessionContext';
import { useEffect, useState, useMemo } from 'react';

interface Role {
    org: { id: number; org_uuid: string };
    role: { 
        id: number; 
        role_uuid: string;
        rights?: {
            [key: string]: {
                [key: string]: boolean;
            };
        };
    };
}

interface Rights {
    courses: {
        action_create: boolean;
        action_read: boolean;
        action_read_own: boolean;
        action_update: boolean;
        action_update_own: boolean;
        action_delete: boolean;
        action_delete_own: boolean;
    };
    users: {
        action_create: boolean;
        action_read: boolean;
        action_update: boolean;
        action_delete: boolean;
    };
    usergroups: {
        action_create: boolean;
        action_read: boolean;
        action_update: boolean;
        action_delete: boolean;
    };
    collections: {
        action_create: boolean;
        action_read: boolean;
        action_update: boolean;
        action_delete: boolean;
    };
    organizations: {
        action_create: boolean;
        action_read: boolean;
        action_update: boolean;
        action_delete: boolean;
    };
    coursechapters: {
        action_create: boolean;
        action_read: boolean;
        action_update: boolean;
        action_delete: boolean;
    };
    activities: {
        action_create: boolean;
        action_read: boolean;
        action_update: boolean;
        action_delete: boolean;
    };
    roles: {
        action_create: boolean;
        action_read: boolean;
        action_update: boolean;
        action_delete: boolean;
    };
    dashboard: {
        action_access: boolean;
    };
}

interface UseAdminStatusReturn {
    isAdmin: boolean | null;
    loading: boolean;
    userRoles: Role[];
    rights: Rights | null;
}

function useAdminStatus(): UseAdminStatusReturn {
    const session = useLHSession() as any;
    const org = useOrg() as any;
    const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
    const [loading, setLoading] = useState<boolean>(true);
    const [rights, setRights] = useState<Rights | null>(null);

    const userRoles = useMemo(() => session?.data?.roles || [], [session?.data?.roles]);

    useEffect(() => {
        if (session.status === 'authenticated' && org?.id) {
            // Extract rights from the backend session data
            const extractRightsFromRoles = (): Rights | null => {
                if (!userRoles || userRoles.length === 0) return null;
                
                // Find roles for the current organization
                const orgRoles = userRoles.filter((role: Role) => role.org.id === org.id);
                if (orgRoles.length === 0) return null;
                
                // Merge rights from all roles for this organization
                const mergedRights: Rights = {
                    courses: {
                        action_create: false,
                        action_read: false,
                        action_read_own: false,
                        action_update: false,
                        action_update_own: false,
                        action_delete: false,
                        action_delete_own: false
                    },
                    users: {
                        action_create: false,
                        action_read: false,
                        action_update: false,
                        action_delete: false
                    },
                    usergroups: {
                        action_create: false,
                        action_read: false,
                        action_update: false,
                        action_delete: false
                    },
                    collections: {
                        action_create: false,
                        action_read: false,
                        action_update: false,
                        action_delete: false
                    },
                    organizations: {
                        action_create: false,
                        action_read: false,
                        action_update: false,
                        action_delete: false
                    },
                    coursechapters: {
                        action_create: false,
                        action_read: false,
                        action_update: false,
                        action_delete: false
                    },
                    activities: {
                        action_create: false,
                        action_read: false,
                        action_update: false,
                        action_delete: false
                    },
                    roles: {
                        action_create: false,
                        action_read: false,
                        action_update: false,
                        action_delete: false
                    },
                    dashboard: {
                        action_access: false
                    }
                };
                
                // Merge rights from all roles
                orgRoles.forEach((role: Role) => {
                    if (role.role.rights) {
                        Object.keys(role.role.rights).forEach((resourceType) => {
                            if (mergedRights[resourceType as keyof Rights]) {
                                Object.keys(role.role.rights![resourceType]).forEach((action) => {
                                    if (role.role.rights![resourceType][action] === true) {
                                        (mergedRights[resourceType as keyof Rights] as any)[action] = true;
                                    }
                                });
                            }
                        });
                    }
                });
                
                return mergedRights;
            };
            
            const extractedRights = extractRightsFromRoles();
            setRights(extractedRights);
            
            // User is admin only if they have dashboard access
            const isAdminVar = extractedRights?.dashboard?.action_access === true;
            setIsAdmin(isAdminVar);
            
            setLoading(false);
        } else {
            setIsAdmin(false);
            setRights(null);
            setLoading(false);
        }
    }, [session.status, userRoles, org.id]);

    return { isAdmin, loading, userRoles, rights };
}

export default useAdminStatus;

