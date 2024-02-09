import { AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime'

export const denyAccessToUser = (error: any, router: AppRouterInstance) => {
  if (error.status === 401) {
    router.push('/login')
  }

  if (error.status === 403) {
    router.push('/login')
    // TODO : add a message to the user to tell him he is not allowed to access this page, route to /error
  }
}
