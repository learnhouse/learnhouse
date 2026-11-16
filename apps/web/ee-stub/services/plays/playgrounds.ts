// OSS stub: Plays require Enterprise Edition. Lists are empty and a single
// play is never found, so the routes that load one answer 404.

function notAvailable(): never {
  throw Object.assign(new Error('Plays require LearnHouse Enterprise'), { status: 404 })
}

export async function getOrgPlaygrounds(_orgId: number, _access_token?: string): Promise<any[]> {
  return []
}

export async function getPlayground(_playgroundUuid: string, _access_token?: string): Promise<any> {
  notAvailable()
}
