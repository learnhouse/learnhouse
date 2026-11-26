// Names the doc samples use without declaring them. A sample that declares
// one itself (`const lh = createClient(...)`) shadows it.
// Used by scripts/check-doc-snippets.mjs only.

declare const lh: import('@learnhouse/sdk').LearnHouseClient
declare const server: import('@learnhouse/sdk').LearnHouseClient
declare const learner: { id: number; email: string }
declare const ORG: string
declare const org: import('@learnhouse/sdk').Organization
declare const me: import('@learnhouse/sdk').User
declare const baseUrl: string
declare const token: string
declare const email: string
declare const password: string
declare const newPassword: string
declare const code: string
declare const courseUuid: string
declare const activityUuid: string
declare const assignmentUuid: string
declare const taskUuid: string
declare const userId: number
declare const userUuid: string
declare const fileId: string
declare const idFromUrl: string
declare const id: string
declare const file: Blob
declare const rawBody: string
declare const stored: { refreshToken: string; refresh_token: string; access_token: string }
declare const tokenStore: { accessToken: string | null }
declare const metrics: { timing(name: string, label: string, value: number): void }
declare function save(accessToken: string, refreshToken: string): Promise<void>
declare function render(value: unknown): void
declare function showLinkExpired(): void
declare function refreshMyCourseSidebar(activityId: string, completed: boolean): void
declare function getCurrentUser(): Promise<{ learnhouseUserId: number } | null>
declare const process: { env: Record<string, string | undefined> }

// Third-party modules some samples import; only the LearnHouse calls are checked.
declare module 'expo-secure-store'
declare module 'expo-notifications'
declare module 'next/server'
declare module 'express' {
  type Handler = (req: any, res: any) => unknown
  function express(): { post(path: string, middleware: unknown, handler: Handler): void }
  namespace express {
    function raw(options: { type: string }): unknown
  }
  export default express
}
declare module 'node:crypto' {
  export const webcrypto: Crypto
}

declare const req: Request
declare const timestamp: string

// The React components, for markup-only samples (```tsx starting with `<`).
declare const LearnHouseProvider: typeof import('@learnhouse/react').LearnHouseProvider
declare const LearnHouseActivity: typeof import('@learnhouse/react').LearnHouseActivity
declare const AgentChat: typeof import('@learnhouse/react').AgentChat
declare const activity: import('@learnhouse/react').LearnHouseActivityData
declare const doc: import('@learnhouse/react').ActivityDocument
declare const session: import('@learnhouse/sdk').LearnHouseSessionInput

// SDK values the docs import once per page and then use freely.
declare const createClient: typeof import('@learnhouse/sdk').createClient
declare const isLearnHouseError: typeof import('@learnhouse/sdk').isLearnHouseError
declare const LearnHouseError: typeof import('@learnhouse/sdk').LearnHouseError
declare const paginate: typeof import('@learnhouse/sdk').paginate
declare const courseProgress: typeof import('@learnhouse/sdk').courseProgress
declare const SecureStore: {
  getItemAsync(key: string): Promise<string | null>
  setItemAsync(key: string, value: string): Promise<void>
  deleteItemAsync(key: string): Promise<void>
}

// Next.js adds `next` to fetch's options; samples for Next use it.
interface RequestInit {
  next?: { revalidate?: number | false; tags?: string[] }
}

declare module '@learnhouse/react/styles.css'
declare module '@learnhouse/vue/styles.css'
declare const analytics: { track(name: string, properties?: unknown): void }

// Placeholders the React samples render or call.
declare const MyLink: import('react').FC<{ href?: string; children?: import('react').ReactNode }>
declare const Breadcrumbs: import('react').FC<{ current?: string }>
declare const NextLessonButton: import('react').FC
declare const LessonSkeleton: import('react').FC
declare const children: import('react').ReactNode
declare const router: { push(path: string): void }
declare function toLocalRoute(href: string): string
declare function markLessonDone(activityId?: string): void
declare const posthog: { capture(name: string, properties?: unknown): void }
declare module 'next/navigation' {
  export function useRouter(): { push(path: string): void; refresh(): void }
}
