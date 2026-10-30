import fs from 'node:fs'
import path from 'node:path'
import type { LearnHouseConfigJson } from '../types.js'

/**
 * Where each edition keeps things. Community is one app container with
 * explicit container names; Enterprise is split into api/web/collab and lets
 * compose name the containers, so commands address services, not names.
 */
export interface StackLayout {
  /** Service that runs the API (and owns the uploaded content). */
  appService: string
  /** Other services that hold database connections and must stop for a restore. */
  dbClients: string[]
  /** Uploaded content inside the app container. */
  contentPath: string
  /** Services whose memory limit `scale` can set. */
  scalableServices: string[]
}

const COMMUNITY: StackLayout = {
  appService: 'learnhouse-app',
  dbClients: ['learnhouse-app'],
  contentPath: '/app/api/content',
  scalableServices: ['learnhouse-app', 'db', 'redis'],
}

const ENTERPRISE: StackLayout = {
  appService: 'api',
  dbClients: ['api', 'collab'],
  contentPath: '/app/content',
  scalableServices: ['api', 'web', 'collab', 'db', 'redis'],
}

export function stackLayout(config: Pick<LearnHouseConfigJson, 'edition'>): StackLayout {
  return config.edition === 'enterprise' ? ENTERPRISE : COMMUNITY
}

/** True if the install's docker-compose.yml declares `service` (read from the file; no daemon needed). */
export function hasComposeService(installDir: string, service: string): boolean {
  const composePath = path.join(installDir, 'docker-compose.yml')
  if (!fs.existsSync(composePath)) return false
  const escaped = service.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`^  ${escaped}:\\s*$`, 'm').test(fs.readFileSync(composePath, 'utf-8'))
}

/** Database lives outside the stack: no `db` service in the compose file. */
export function usesExternalDb(installDir: string): boolean {
  const composePath = path.join(installDir, 'docker-compose.yml')
  return fs.existsSync(composePath) && !hasComposeService(installDir, 'db')
}

/** Uploaded content is stored in S3 rather than the app's content directory. */
export function usesS3Content(installDir: string): boolean {
  const envPath = path.join(installDir, '.env')
  if (!fs.existsSync(envPath)) return false
  return /^LEARNHOUSE_CONTENT_DELIVERY_TYPE\s*=\s*['"]?s3api['"]?\s*$/m.test(fs.readFileSync(envPath, 'utf-8'))
}

/**
 * Public URL of an install. With manual HTTPS, TLS ends at the user's own
 * proxy on 443, and httpPort is only the plain-HTTP port that proxy forwards
 * to, so it never appears in the URL. Caddy (auto SSL) publishes 443 on
 * httpPort; plain HTTP keeps a non-80 port.
 */
export function publicUrl(config: Pick<LearnHouseConfigJson, 'useHttps' | 'autoSsl' | 'httpPort' | 'domain'>): string {
  if (config.useHttps) {
    const port = config.autoSsl && config.httpPort !== 443 ? `:${config.httpPort}` : ''
    return `https://${config.domain}${port}`
  }
  return `http://${config.domain}${config.httpPort === 80 ? '' : `:${config.httpPort}`}`
}
