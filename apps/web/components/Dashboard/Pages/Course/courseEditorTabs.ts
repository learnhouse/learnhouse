// Which editor tab owns each course field, so the tab bar can mark the tabs
// that hold unsaved edits.
const FIELD_TAB: Record<string, string> = {
  seo: 'seo',
  public: 'access',
  open_to_contributors: 'contributors',
}

export function courseMetaDirtyTabs(changes: Record<string, unknown> | undefined | null): Set<string> {
  const tabs = new Set<string>()
  for (const key of Object.keys(changes ?? {})) {
    // Private keys (e.g. the old `_certificationData` buffer) are not fields.
    if (key.startsWith('_')) continue
    tabs.add(FIELD_TAB[key] ?? 'general')
  }
  return tabs
}
