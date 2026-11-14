// Whether an activity is edited live (real-time collaboration + autosave) or
// alone with manual saving. Org default in the org config JSON, per-activity
// override in the activity's details. The API applies the same rules.

export type LiveEditingMode = 'default' | 'on' | 'off'

export function orgLiveEditing(orgConfig: any): boolean {
  return orgConfig?.features?.collaboration?.live_editing !== false
}

export function activityLiveEditingMode(details: any): LiveEditingMode {
  const value = details && typeof details === 'object' ? details.live_editing : undefined
  return value === 'on' || value === 'off' ? value : 'default'
}

export function resolveLiveEditing(mode: LiveEditingMode, orgDefault: boolean): boolean {
  return mode === 'default' ? orgDefault : mode === 'on'
}
