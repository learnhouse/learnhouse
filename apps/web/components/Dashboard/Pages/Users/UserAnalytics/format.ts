import { getUserAvatarMediaDirectory } from '@services/media/media'

export function fmtDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—'
  try {
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) return '—'
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch {
    return '—'
  }
}

export function fmtDateTime(dateStr: string | null | undefined): string {
  if (!dateStr) return '—'
  try {
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) return '—'
    return d.toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
    })
  } catch {
    return '—'
  }
}

/** Seconds -> compact human duration (e.g. "2h 14m", "45m", "30s"). */
export function fmtDuration(seconds: number | null | undefined): string {
  const s = Number(seconds || 0)
  if (!s || s < 0) return '0m'
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`
  if (m > 0) return `${m}m`
  return `${Math.floor(s)}s`
}

export function fullName(user: any): string {
  const name = `${user?.first_name || ''} ${user?.last_name || ''}`.trim()
  return name || user?.username || 'Unknown'
}

export function avatarUrl(user: any): string | undefined {
  if (user?.avatar_image && user?.user_uuid) {
    return getUserAvatarMediaDirectory(user.user_uuid, user.avatar_image)
  }
  return undefined
}
