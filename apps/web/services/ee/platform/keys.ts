import { queryKeys } from '@/lib/query/keys'

// Query keys for the platform console. Lists that the API playground also
// invalidates (orgs, users, tokens, analytics) reuse the shared superadmin
// keys so both stay in sync.
export const platformKeys = {
  all: ['platform'] as const,
  me: () => ['platform', 'me'] as const,
  user: (userId: string | number) => ['platform', 'user', String(userId)] as const,
  overview: (days: number) => ['platform', 'overview', days] as const,
  search: (q: string) => ['platform', 'search', q] as const,
  system: () => ['platform', 'system'] as const,
  team: () => ['platform', 'team'] as const,
  audit: (filters: object) => ['platform', 'audit', filters] as const,
  orgs: (filters?: object) => (filters ? ([...queryKeys.superadmin.orgs(), filters] as const) : queryKeys.superadmin.orgs()),
  orgVisits: () => ['superadmin', 'orgs', 'visits'] as const,
  org: (orgId: string | number) => ['platform', 'org', String(orgId)] as const,
  orgDetail: (orgId: string | number) => ['platform', 'org', String(orgId), 'detail'] as const,
  orgUsage: (orgId: string | number) => ['platform', 'org', String(orgId), 'usage'] as const,
  orgAnalytics: (orgId: string | number, days: number) => ['platform', 'org', String(orgId), 'analytics', days] as const,
  orgCourses: (orgId: string | number, page: number) => ['platform', 'org', String(orgId), 'courses', page] as const,
  orgUsers: (orgId: string | number, page: number, search: string) => ['platform', 'org', String(orgId), 'users', page, search] as const,
  orgProfile: (orgId: string | number) => ['platform', 'org', String(orgId), 'profile'] as const,
  orgNotes: (orgId: string | number) => ['platform', 'org', String(orgId), 'notes'] as const,
  orgActivity: (orgId: string | number) => ['platform', 'org', String(orgId), 'activity'] as const,
  orgConfiguration: (orgId: string | number) => ['platform', 'org', String(orgId), 'configuration'] as const,
  orgConfigHistory: (orgId: string | number) => ['platform', 'org', String(orgId), 'configuration', 'history'] as const,
  aiCredits: (orgId: string | number) => ['superadmin', 'org', String(orgId), 'ai-credits'] as const,
  pocs: (status: string) => ['platform', 'pocs', status] as const,
  pocsAll: () => ['platform', 'pocs'] as const,
  automations: () => ['platform', 'automations'] as const,
  automationTemplates: () => ['platform', 'automations', 'templates'] as const,
  automationSchema: () => ['platform', 'automations', 'schema'] as const,
  automationRuns: (uuid: string, page: number) => ['platform', 'automations', uuid, 'runs', page] as const,
  recentRuns: () => ['platform', 'automations', 'runs', 'recent'] as const,
  users: (query?: object) => (query ? ([...queryKeys.superadmin.users(), query] as const) : queryKeys.superadmin.users()),
  globalAnalytics: (days: number) => [...queryKeys.superadmin.analytics(), days] as const,
  aiCosts: (days: number, feature: string) => ['platform', 'ai-costs', days, feature] as const,
  orgAiCosts: (orgId: string | number, days: number) => ['platform', 'org', String(orgId), 'ai-costs', days] as const,
  tokens: () => queryKeys.superadmin.apiTokens(),
}

export const auditKeys = {
  unified: (filters: object) => ['platform', 'audit-unified', filters] as const,
  unifiedAll: () => ['platform', 'audit-unified'] as const,
  facets: (filters: object) => ['platform', 'audit-unified', 'facets', filters] as const,
  head: (filters: object) => ['platform', 'audit-unified', 'head', filters] as const,
  event: (source: string, id: string) => ['platform', 'audit-unified', 'event', source, id] as const,
}
