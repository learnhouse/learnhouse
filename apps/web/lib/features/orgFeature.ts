/**
 * Whether the backend enabled a feature for an org (plan + overrides + admin
 * toggles), read from org.config.config.resolved_features. Usable outside
 * React (route handlers, server components). Missing data counts as off.
 */
export function isOrgFeatureEnabled(org: any, feature: string): boolean {
  return org?.config?.config?.resolved_features?.[feature]?.enabled === true
}
