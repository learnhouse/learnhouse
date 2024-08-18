export const LEARNHOUSE_HTTP_PROTOCOL =
  process.env.NEXT_PUBLIC_LEARNHOUSE_HTTPS === 'true' ? 'https://' : 'http://'
export const LEARNHOUSE_API_URL = `${process.env.NEXT_PUBLIC_LEARNHOUSE_API_URL}`
export const LEARNHOUSE_BACKEND_URL = `${process.env.NEXT_PUBLIC_LEARNHOUSE_BACKEND_URL}`
export const LEARNHOUSE_DOMAIN = process.env.NEXT_PUBLIC_LEARNHOUSE_DOMAIN
export const LEARNHOUSE_TOP_DOMAIN =
  process.env.NEXT_PUBLIC_LEARNHOUSE_TOP_DOMAIN
export const LEARNHOUSE_COLLABORATION_WS_URL =
  process.env.NEXT_PUBLIC_LEARNHOUSE_COLLABORATION_WS_URL
export const UPSTASH_REDIS_REST_URL = process.env.UPSTASH_REDIS_REST_URL
export const UPSTASH_REDIS_REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN

export const getAPIUrl = () => LEARNHOUSE_API_URL
export const getBackendUrl = () => LEARNHOUSE_BACKEND_URL

export const isMultiOrgModeEnabled = () =>
  process.env.NEXT_PUBLIC_LEARNHOUSE_MULTI_ORG === 'true'

const getDomain = (cookies?: any) => {
  if (cookies && cookies.learnhouseCustomDomain) {
    return cookies.learnhouseCustomDomain
  } else {
    return null
  }
}

export const getUriWithOrg = (orgslug: string, path: string, cookies?: any) => {
  const multi_org = isMultiOrgModeEnabled()
  const customDomain = getDomain(cookies)
  if (multi_org) {
    if (customDomain) {
      return `${LEARNHOUSE_HTTP_PROTOCOL}${customDomain}${path}`
    } else {
      return `${LEARNHOUSE_HTTP_PROTOCOL}${orgslug}.${LEARNHOUSE_DOMAIN}${path}`
    }
  }
  return `${LEARNHOUSE_HTTP_PROTOCOL}${LEARNHOUSE_DOMAIN}${path}`
}

export const getUriWithoutOrg = (path: string, cookies?: any) => {
  const multi_org = isMultiOrgModeEnabled()
  const customDomain = getDomain(cookies)
  if (multi_org) {
    if (customDomain) {
      return `${LEARNHOUSE_HTTP_PROTOCOL}${customDomain}${path}`
    } else {
      return `${LEARNHOUSE_HTTP_PROTOCOL}${LEARNHOUSE_DOMAIN}${path}`
    }
  }
  return `${LEARNHOUSE_HTTP_PROTOCOL}${LEARNHOUSE_DOMAIN}${path}`
}

export const getDefaultOrg = () =>
  process.env.NEXT_PUBLIC_LEARNHOUSE_DEFAULT_ORG

export const getCollaborationServerUrl = () =>
  `${LEARNHOUSE_COLLABORATION_WS_URL}`
