import { getCookieValue } from './utils'

export const LEARNHOUSE_HTTP_PROTOCOL = process.env.NEXT_PUBLIC_LEARNHOUSE_HTTPS === 'true' ? 'https://' : 'http://'
export const LEARNHOUSE_API_URL = `${process.env.NEXT_PUBLIC_LEARNHOUSE_API_URL}`
export const LEARNHOUSE_BACKEND_URL = `${process.env.NEXT_PUBLIC_LEARNHOUSE_BACKEND_URL}`
export const LEARNHOUSE_DOMAIN = process.env.NEXT_PUBLIC_LEARNHOUSE_DOMAIN
export const LEARNHOUSE_TOP_DOMAIN = process.env.NEXT_PUBLIC_LEARNHOUSE_TOP_DOMAIN
export const LEARNHOUSE_COLLABORATION_WS_URL = process.env.NEXT_PUBLIC_LEARNHOUSE_COLLABORATION_WS_URL
export const UPSTASH_REDIS_REST_URL = process.env.UPSTASH_REDIS_REST_URL
export const UPSTASH_REDIS_REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN

export const getAPIUrl = () => LEARNHOUSE_API_URL
export const getBackendUrl = () => LEARNHOUSE_BACKEND_URL

export const isMultiOrgModeEnabled = () => process.env.NEXT_PUBLIC_LEARNHOUSE_MULTI_ORG === 'true'
export const isCustomDomainsEnabled = () => Boolean(getCookieValue('learnhouseCustomDomain'))

const getCustomDomain = () => getCookieValue('learnhouseCustomDomain')

const getDomain = () => {
  if (isCustomDomainsEnabled()) {
    return getCustomDomain()
  }
  return isMultiOrgModeEnabled() ? `${LEARNHOUSE_DOMAIN}` : LEARNHOUSE_DOMAIN
}

export const getUriWithOrg = (orgslug: string, path: string) => {
  const domain = getDomain()
  const subdomain = isMultiOrgModeEnabled() && !isCustomDomainsEnabled() ? `${orgslug}.` : ''
  return `${LEARNHOUSE_HTTP_PROTOCOL}${subdomain}${domain}${path}`
}

export const getUriWithoutOrg = (path: string) => {
  const domain = getDomain()
  return `${LEARNHOUSE_HTTP_PROTOCOL}${domain}${path}`
}

export const getDefaultOrg = () => process.env.NEXT_PUBLIC_LEARNHOUSE_DEFAULT_ORG

export const getCollaborationServerUrl = () => `${LEARNHOUSE_COLLABORATION_WS_URL}`