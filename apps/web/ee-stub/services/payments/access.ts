// OSS stub: paid access requires Enterprise Edition. Nothing is ever locked.
const none = { success: false, status: 404, HTTPmessage: 'Not Found', data: null }

export async function getResourcePaywall(_orgId: number, _resourceUuid: string, _access_token?: string | null): Promise<any> {
  return none
}

export async function getMyCourseAccess(_orgId: number, _courseUuid: string, _access_token?: string | null): Promise<any> {
  return none
}
