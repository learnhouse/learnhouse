import { QueryClient } from '@tanstack/react-query'

export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60_000,
        // Unused entries stay in memory for half an hour, so going back to a
        // dashboard page after a while still paints from cache (and refreshes
        // in the background) instead of starting from a skeleton.
        gcTime: 30 * 60_000,
        refetchOnWindowFocus: false,
        retry: 1,
      },
    },
  })
}
