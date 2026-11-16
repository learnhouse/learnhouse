// OSS stub: live sessions require Enterprise Edition.
export async function getLiveSession(_uuid: string, _token?: string): Promise<any> {
  throw Object.assign(new Error('Not Found'), { status: 404 })
}

export async function getLiveSessions(_orgId: number, _scope: string, _token?: string, _opts: Record<string, unknown> = {}): Promise<any[]> {
  return []
}
