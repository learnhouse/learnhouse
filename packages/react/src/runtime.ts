// Module-level instance settings read by the web app's config getters
// (see shims/config.ts). Set by <LearnHouseProvider> before its children render.
export const runtime = {
  backendUrl: '',
  apiUrl: '',
  config: {} as Record<string, string>,
}

export function configureRuntime(baseUrl: string, mediaUrl?: string) {
  const backend = baseUrl.replace(/\/+$/, '')
  runtime.backendUrl = backend
  runtime.apiUrl = `${backend}/api/v1`
  runtime.config = {
    NEXT_PUBLIC_LEARNHOUSE_BACKEND_URL: `${backend}/`,
    ...(mediaUrl ? { NEXT_PUBLIC_LEARNHOUSE_MEDIA_URL: mediaUrl } : {}),
  }
}
