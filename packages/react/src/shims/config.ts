// The web app's runtime config, pointed at the LearnHouse instance given to
// <LearnHouseProvider> instead of the page's own host. Everything not
// overridden here is the web app's implementation.
import { getConfig as webGetConfig } from '../../../../apps/web/services/config/config'
import { runtime } from '../runtime'

export * from '../../../../apps/web/services/config/config'

const withSlash = (url: string) => (url.endsWith('/') ? url : `${url}/`)

export const getConfig = (key: string, defaultValue = ''): string =>
  runtime.config[key] ?? webGetConfig(key, defaultValue)

// The host page is never a LearnHouse custom domain, so never fall back to a
// same-origin /api/v1 proxy that only exists inside the web app.
export const isOnCustomDomain = (): boolean => false
export const getCustomDomainFromContext = (): string | null => null

export const getBackendUrl = () => withSlash(runtime.backendUrl)
export const getAPIUrl = () => withSlash(runtime.apiUrl)
export const getServerAPIUrl = getAPIUrl
