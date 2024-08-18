import { Redis } from '@upstash/redis'
import { UPSTASH_REDIS_REST_TOKEN, UPSTASH_REDIS_REST_URL } from './config'

const redis = new Redis({
  url: UPSTASH_REDIS_REST_URL,
  token: UPSTASH_REDIS_REST_TOKEN,
})

const exampleObject = {
  domain: 'learnhouse.io',
  orgslug: 'default',
}

export async function getDataFromCustomDomainRegistry(domain: any) {
  if (!domain) return null

  try {
    console.log('looking for the custom domain...')
    let value = (await redis.json.get(`customdomain:${domain}`)) as any
    console.log('val', value)
    if (!value) return null

    return value || null
  } catch (error) {
    console.error('Redis error:', error)
    return null
  }
}

export function getCookieValue(name: string): string | null {
  const cookieString = document.cookie;
  
  // Create a regular expression to match the specific cookie name
  const match = cookieString.match(new RegExp('(^| )' + name + '=([^;]+)'));
  
  // Return the value if found, or null if not
  return match ? decodeURIComponent(match[2]) : null;
}

