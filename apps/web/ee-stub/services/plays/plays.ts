// OSS stub: Plays require Enterprise Edition; a play is never found (404).

export async function getPlayForLearner(_playgroundUuid: string, _access_token?: string): Promise<any> {
  throw Object.assign(new Error('Plays require LearnHouse Enterprise'), { status: 404 })
}
