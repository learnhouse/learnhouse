import { RequestBodyWithAuthHeader } from "@services/utils/ts/requests"
import { getAPIUrl } from "@services/config/config"
import { errorHandling, getResponseMetadata } from "@services/utils/ts/requests"

export async function searchOrgContent(
    org_slug: string,
    query: string,
    page: number = 1,
    limit: number = 10,
    next: any,
    access_token?: any
  ) {
    const result: any = await fetch(
      `${getAPIUrl()}search/org_slug/${org_slug}?query=${encodeURIComponent(query)}&page=${page}&limit=${limit}`,
      RequestBodyWithAuthHeader('GET', null, next, access_token)
    )
    const res = await getResponseMetadata(result)
    return res
  }