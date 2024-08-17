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

export async function getOrgSlugFromCustomDomainRegistry(domain: any) {
  if (!domain) return null

  try {
    console.log('looking for the custom domain...')
    let value = (await redis.json.get(`customdomain:${domain}`)) as any
    console.log('val', value.orgslug)
    if (!value) return null

    return value.orgslug || null
  } catch (error) {
    console.error('Redis error:', error)
    return null
  }
}
