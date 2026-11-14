'use client'
// Kept apart from the renderer so the home page can start fetching the
// published page while the renderer's chunk is still downloading.
import { useQuery } from '@tanstack/react-query'
import { getPublicLandingPage, landingQueryKeys, type PublicLandingPage } from '@services/landing/landing'

export function usePublicLandingPage(orgslug: string, slug: string, preview?: string | null, enabled = true) {
  return useQuery<PublicLandingPage>({
    queryKey: landingQueryKeys.publicPage(orgslug, slug, preview),
    queryFn: () => getPublicLandingPage(orgslug, slug, preview),
    enabled: enabled && !!orgslug,
    staleTime: preview ? 0 : 60_000,
    retry: (count, err: any) => err?.status !== 404 && count < 2,
  })
}
