// next/navigation outside Next.js: read the browser location, navigate with it.
const hasWindow = typeof window !== 'undefined'

export function useRouter() {
  return {
    push: (url: string) => hasWindow && window.location.assign(url),
    replace: (url: string) => hasWindow && window.location.replace(url),
    back: () => hasWindow && window.history.back(),
    forward: () => hasWindow && window.history.forward(),
    refresh: () => {},
    prefetch: () => {},
  }
}

export function usePathname(): string {
  return hasWindow ? window.location.pathname : '/'
}

export function useSearchParams(): URLSearchParams {
  return new URLSearchParams(hasWindow ? window.location.search : '')
}

export function useParams<T = Record<string, string>>(): T {
  return {} as T
}

export function redirect(url: string): never {
  if (hasWindow) window.location.assign(url)
  throw new Error(`redirect(${url})`)
}

export function notFound(): never {
  throw new Error('notFound()')
}
