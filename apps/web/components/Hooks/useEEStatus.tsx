import { getDeploymentMode } from '@services/config/config'

/**
 * Returns whether the Enterprise Edition package is installed.
 *
 * Reads the learnhouse_mode cookie set by the middleware from the backend /instance/info.
 * Synchronous — no async loading needed since the cookie is always available.
 */
export const useEEStatus = () => {
  const mode = getDeploymentMode()
  return { isEE: mode === 'ee', isLoading: false }
}
