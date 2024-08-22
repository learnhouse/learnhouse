import { Redis } from '@upstash/redis'
import { UPSTASH_REDIS_REST_TOKEN, UPSTASH_REDIS_REST_URL } from './config'

let redis: Redis | null = null

// Initialize Redis only if the URL and token are provided
if (UPSTASH_REDIS_REST_URL && UPSTASH_REDIS_REST_TOKEN) {
  redis = new Redis({
    url: UPSTASH_REDIS_REST_URL,
    token: UPSTASH_REDIS_REST_TOKEN,
  })
}

export async function getDataFromCustomDomainRegistry(domain: any) {
  if (!domain) return null

  if (!redis) {
    console.error('Redis is not initialized. Missing URL or token.')
    return null
  }

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
