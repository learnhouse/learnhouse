// Role permission model shared by the roles list and the role editor. Mirrors
// the backend Rights schema: every resource has a fixed set of actions, and
// the API expects every flag to be present (false when off).

export type RoleRights = Record<string, Record<string, boolean>>

// Every action column the matrix can show, in display order.
export const ACTION_COLUMNS = [
    'action_create',
    'action_read',
    'action_read_own',
    'action_update',
    'action_update_own',
    'action_delete',
    'action_delete_own',
    'action_access',
] as const

const CRUD = ['action_create', 'action_read', 'action_update', 'action_delete']

// Resources in display order, each with the actions it supports.
export const ROLE_RESOURCES: { key: string; actions: string[] }[] = [
    {
        key: 'courses',
        actions: ['action_create', 'action_read', 'action_read_own', 'action_update', 'action_update_own', 'action_delete', 'action_delete_own'],
    },
    { key: 'coursechapters', actions: CRUD },
    { key: 'activities', actions: CRUD },
    { key: 'folders', actions: CRUD },
    { key: 'media', actions: CRUD },
    { key: 'users', actions: CRUD },
    { key: 'usergroups', actions: CRUD },
    { key: 'roles', actions: CRUD },
    { key: 'organizations', actions: CRUD },
    { key: 'dashboard', actions: ['action_access'] },
]

export const TOTAL_PERMISSIONS = ROLE_RESOURCES.reduce((n, r) => n + r.actions.length, 0)

// Fills every resource/action with a boolean so the payload always matches the
// schema, whatever shape the stored role (or a preset) had.
export function normalizeRights(raw: any): RoleRights {
    const out: RoleRights = {}
    for (const res of ROLE_RESOURCES) {
        out[res.key] = {}
        for (const action of res.actions) out[res.key][action] = !!raw?.[res.key]?.[action]
    }
    return out
}

export function countEnabled(rights: any): number {
    if (!rights || typeof rights !== 'object') return 0
    return Object.values(rights).reduce<number>((acc, actions) => {
        if (!actions || typeof actions !== 'object') return acc
        return acc + Object.values(actions as Record<string, unknown>).filter((v) => v === true).length
    }, 0)
}

// Every flag the stored role carries, on or off. Stored roles can hold more
// resources than the editor shows, so the list bar measures against this.
export function countFlags(rights: any): number {
    if (!rights || typeof rights !== 'object') return 0
    return Object.values(rights).reduce<number>(
        (acc, actions) => acc + (actions && typeof actions === 'object' ? Object.keys(actions).length : 0),
        0
    )
}

// i18n key segment for a preset name (keeps the historical key names).
export function presetKey(name: string) {
    if (name === 'Course Manager') return 'maintainer'
    if (name === 'Content Creator') return 'content_creator'
    if (name === 'User Manager') return 'user_manager'
    return name.toLowerCase()
}

// A role is system-wide (read-only here) when the backend marks it global, or
// it is one of the built-in roles.
export function isSystemRole(role: any) {
    if (!role) return false
    if (role.role_type === 'TYPE_GLOBAL') return true
    if (typeof role.role_uuid === 'string' && role.role_uuid.startsWith('role_global_')) return true
    if (role.id && [1, 2, 3, 4].includes(role.id)) return true
    if (role.name && ['Admin', 'Maintainer', 'Instructor', 'User'].includes(role.name)) return true
    return false
}

export const PREDEFINED_ROLES: Record<string, { name: string; description: string; rights: RoleRights }> = {
    'Admin': {
        name: 'Admin',
        description: 'Full platform control with all permissions',
        rights: {
            courses: { action_create: true, action_read: true, action_read_own: true, action_update: true, action_update_own: true, action_delete: true, action_delete_own: true },
            users: { action_create: true, action_read: true, action_update: true, action_delete: true },
            usergroups: { action_create: true, action_read: true, action_update: true, action_delete: true },
            folders: { action_create: true, action_read: true, action_update: true, action_delete: true },
            media: { action_create: true, action_read: true, action_update: true, action_delete: true },
            organizations: { action_create: true, action_read: true, action_update: true, action_delete: true },
            coursechapters: { action_create: true, action_read: true, action_update: true, action_delete: true },
            activities: { action_create: true, action_read: true, action_update: true, action_delete: true },
            roles: { action_create: true, action_read: true, action_update: true, action_delete: true },
            dashboard: { action_access: true }
        }
    },
    'Course Manager': {
        name: 'Course Manager',
        description: 'Can manage courses, chapters, and activities',
        rights: {
            courses: { action_create: true, action_read: true, action_read_own: true, action_update: true, action_update_own: true, action_delete: false, action_delete_own: true },
            users: { action_create: false, action_read: true, action_update: false, action_delete: false },
            usergroups: { action_create: false, action_read: true, action_update: false, action_delete: false },
            folders: { action_create: true, action_read: true, action_update: true, action_delete: false },
            media: { action_create: true, action_read: true, action_update: true, action_delete: false },
            organizations: { action_create: false, action_read: false, action_update: false, action_delete: false },
            coursechapters: { action_create: true, action_read: true, action_update: true, action_delete: false },
            activities: { action_create: true, action_read: true, action_update: true, action_delete: false },
            roles: { action_create: false, action_read: false, action_update: false, action_delete: false },
            dashboard: { action_access: true }
        }
    },
    'Instructor': {
        name: 'Instructor',
        description: 'Can create and manage their own courses',
        rights: {
            courses: { action_create: true, action_read: true, action_read_own: true, action_update: false, action_update_own: true, action_delete: false, action_delete_own: true },
            users: { action_create: false, action_read: false, action_update: false, action_delete: false },
            usergroups: { action_create: false, action_read: false, action_update: false, action_delete: false },
            folders: { action_create: false, action_read: true, action_update: false, action_delete: false },
            media: { action_create: false, action_read: true, action_update: false, action_delete: false },
            organizations: { action_create: false, action_read: false, action_update: false, action_delete: false },
            coursechapters: { action_create: true, action_read: true, action_update: false, action_delete: false },
            activities: { action_create: true, action_read: true, action_update: false, action_delete: false },
            roles: { action_create: false, action_read: false, action_update: false, action_delete: false },
            dashboard: { action_access: true }
        }
    },
    'Viewer': {
        name: 'Viewer',
        description: 'Read-only access to courses and content',
        rights: {
            courses: { action_create: false, action_read: true, action_read_own: true, action_update: false, action_update_own: false, action_delete: false, action_delete_own: false },
            users: { action_create: false, action_read: false, action_update: false, action_delete: false },
            usergroups: { action_create: false, action_read: false, action_update: false, action_delete: false },
            folders: { action_create: false, action_read: true, action_update: false, action_delete: false },
            media: { action_create: false, action_read: true, action_update: false, action_delete: false },
            organizations: { action_create: false, action_read: false, action_update: false, action_delete: false },
            coursechapters: { action_create: false, action_read: true, action_update: false, action_delete: false },
            activities: { action_create: false, action_read: true, action_update: false, action_delete: false },
            roles: { action_create: false, action_read: false, action_update: false, action_delete: false },
            dashboard: { action_access: true }
        }
    },
    'Content Creator': {
        name: 'Content Creator',
        description: 'Can create and edit content but not manage users',
        rights: {
            courses: { action_create: true, action_read: true, action_read_own: true, action_update: true, action_update_own: true, action_delete: false, action_delete_own: false },
            users: { action_create: false, action_read: false, action_update: false, action_delete: false },
            usergroups: { action_create: false, action_read: false, action_update: false, action_delete: false },
            folders: { action_create: true, action_read: true, action_update: true, action_delete: false },
            media: { action_create: true, action_read: true, action_update: true, action_delete: false },
            organizations: { action_create: false, action_read: false, action_update: false, action_delete: false },
            coursechapters: { action_create: true, action_read: true, action_update: true, action_delete: false },
            activities: { action_create: true, action_read: true, action_update: true, action_delete: false },
            roles: { action_create: false, action_read: false, action_update: false, action_delete: false },
            dashboard: { action_access: true }
        }
    },
    'User Manager': {
        name: 'User Manager',
        description: 'Can manage users and user groups',
        rights: {
            courses: { action_create: false, action_read: true, action_read_own: true, action_update: false, action_update_own: false, action_delete: false, action_delete_own: false },
            users: { action_create: true, action_read: true, action_update: true, action_delete: true },
            usergroups: { action_create: true, action_read: true, action_update: true, action_delete: true },
            folders: { action_create: false, action_read: true, action_update: false, action_delete: false },
            media: { action_create: false, action_read: true, action_update: false, action_delete: false },
            organizations: { action_create: false, action_read: false, action_update: false, action_delete: false },
            coursechapters: { action_create: false, action_read: true, action_update: false, action_delete: false },
            activities: { action_create: false, action_read: true, action_update: false, action_delete: false },
            roles: { action_create: false, action_read: true, action_update: false, action_delete: false },
            dashboard: { action_access: true }
        }
    },
    'Moderator': {
        name: 'Moderator',
        description: 'Can moderate content and manage activities',
        rights: {
            courses: { action_create: false, action_read: true, action_read_own: true, action_update: false, action_update_own: false, action_delete: false, action_delete_own: false },
            users: { action_create: false, action_read: true, action_update: false, action_delete: false },
            usergroups: { action_create: false, action_read: true, action_update: false, action_delete: false },
            folders: { action_create: false, action_read: true, action_update: true, action_delete: false },
            media: { action_create: false, action_read: true, action_update: true, action_delete: false },
            organizations: { action_create: false, action_read: false, action_update: false, action_delete: false },
            coursechapters: { action_create: false, action_read: true, action_update: true, action_delete: false },
            activities: { action_create: false, action_read: true, action_update: true, action_delete: false },
            roles: { action_create: false, action_read: false, action_update: false, action_delete: false },
            dashboard: { action_access: true }
        }
    },
    'Analyst': {
        name: 'Analyst',
        description: 'Read-only access with analytics capabilities',
        rights: {
            courses: { action_create: false, action_read: true, action_read_own: true, action_update: false, action_update_own: false, action_delete: false, action_delete_own: false },
            users: { action_create: false, action_read: true, action_update: false, action_delete: false },
            usergroups: { action_create: false, action_read: true, action_update: false, action_delete: false },
            folders: { action_create: false, action_read: true, action_update: false, action_delete: false },
            media: { action_create: false, action_read: true, action_update: false, action_delete: false },
            organizations: { action_create: false, action_read: true, action_update: false, action_delete: false },
            coursechapters: { action_create: false, action_read: true, action_update: false, action_delete: false },
            activities: { action_create: false, action_read: true, action_update: false, action_delete: false },
            roles: { action_create: false, action_read: true, action_update: false, action_delete: false },
            dashboard: { action_access: true }
        }
    },
    'Guest': {
        name: 'Guest',
        description: 'Limited access for external users',
        rights: {
            courses: { action_create: false, action_read: true, action_read_own: false, action_update: false, action_update_own: false, action_delete: false, action_delete_own: false },
            users: { action_create: false, action_read: false, action_update: false, action_delete: false },
            usergroups: { action_create: false, action_read: false, action_update: false, action_delete: false },
            folders: { action_create: false, action_read: true, action_update: false, action_delete: false },
            media: { action_create: false, action_read: true, action_update: false, action_delete: false },
            organizations: { action_create: false, action_read: false, action_update: false, action_delete: false },
            coursechapters: { action_create: false, action_read: true, action_update: false, action_delete: false },
            activities: { action_create: false, action_read: true, action_update: false, action_delete: false },
            roles: { action_create: false, action_read: false, action_update: false, action_delete: false },
            dashboard: { action_access: false }
        }
    }
}

