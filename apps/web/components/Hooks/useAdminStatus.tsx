import { useOrg } from '@components/Contexts/OrgContext';
import { useLHSession } from '@components/Contexts/LHSessionContext';
import { useMemo } from 'react';

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

function extractRightsFromRoles(userRoles: Role[], orgId: number): Rights | null {
    if (!userRoles || userRoles.length === 0) return null;

    const orgRoles = userRoles.filter((role: Role) => role.org.id === orgId);
    if (orgRoles.length === 0) return null;

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
}

// Full-access rights object for superadmins
const SUPERADMIN_RIGHTS: Rights = {
    courses: { action_create: true, action_read: true, action_read_own: true, action_update: true, action_update_own: true, action_delete: true, action_delete_own: true },
    users: { action_create: true, action_read: true, action_update: true, action_delete: true },
    usergroups: { action_create: true, action_read: true, action_update: true, action_delete: true },
    collections: { action_create: true, action_read: true, action_update: true, action_delete: true },
    organizations: { action_create: true, action_read: true, action_update: true, action_delete: true },
    coursechapters: { action_create: true, action_read: true, action_update: true, action_delete: true },
    activities: { action_create: true, action_read: true, action_update: true, action_delete: true },
    roles: { action_create: true, action_read: true, action_update: true, action_delete: true },
    dashboard: { action_access: true },
};

function useAdminStatus(): UseAdminStatusReturn {
    const session = useLHSession() as any;
    const org = useOrg() as any;

    const roles = session.data?.roles;
    const userRoles: Role[] = useMemo(() => roles || [], [roles]);
    const orgId = org?.id;
    const isAuthenticated = session.status === 'authenticated';
    const isSuperadmin = session.data?.user?.is_superadmin === true;

    const rights = useMemo(
        () => {
            if (!isAuthenticated || !orgId) return null;
            // Superadmins get full access to all orgs without needing a role entry
            if (isSuperadmin) return SUPERADMIN_RIGHTS;
            return extractRightsFromRoles(userRoles, orgId);
        },
        [isAuthenticated, userRoles, orgId, isSuperadmin]
    );

    const isAdmin = useMemo(
        () => (isAuthenticated && orgId ? isSuperadmin || rights?.dashboard?.action_access === true : false),
        [isAuthenticated, orgId, isSuperadmin, rights]
    );

    const loading = !isAuthenticated && session.status !== 'unauthenticated';

    return { isAdmin, loading, userRoles, rights };
}

export default useAdminStatus;

