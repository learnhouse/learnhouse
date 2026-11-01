import fs from 'node:fs'
import path from 'node:path'
import * as p from '../utils/prompt.js'
import pc from 'picocolors'
import { findInstallDir, readConfig, updateConfig } from '../services/config-store.js'
import { applyComposeChanges } from './scale.js'
import { quoteEnvValue } from '../utils/env-quote.js'
import { unquoteEnvValue } from '../utils/env-file.js'
import { writeFileAtomic } from '../utils/fs-atomic.js'

const SECRET_PATTERNS = ['PASSWORD', 'SECRET', 'API_KEY', 'LICENSE_KEY', 'INTERNAL_KEY', 'TOKEN', 'CONNECTION_STRING', 'REDIS_URL']

type Categories = Record<string, { label: string; keys: string[] }>

const COMMUNITY_CATEGORIES: Categories = {
  domain: {
    label: 'Domain & Hosting',
    keys: [
      'LEARNHOUSE_DOMAIN', 'HTTP_PORT', 'NEXT_PUBLIC_LEARNHOUSE_API_URL',
      'NEXT_PUBLIC_LEARNHOUSE_BACKEND_URL', 'NEXT_PUBLIC_LEARNHOUSE_DOMAIN',
      'NEXT_PUBLIC_LEARNHOUSE_TOP_DOMAIN', 'NEXT_PUBLIC_LEARNHOUSE_MULTI_ORG',
      'NEXT_PUBLIC_LEARNHOUSE_DEFAULT_ORG', 'NEXT_PUBLIC_LEARNHOUSE_HTTPS',
      'NEXTAUTH_URL',
    ],
  },
  database: {
    label: 'Database & Redis',
    keys: [
      'LEARNHOUSE_SQL_CONNECTION_STRING', 'LEARNHOUSE_REDIS_CONNECTION_STRING',
      'POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_DB',
    ],
  },
  security: {
    label: 'Security',
    keys: [
      'NEXTAUTH_SECRET', 'LEARNHOUSE_AUTH_JWT_SECRET_KEY',
      'LEARNHOUSE_INITIAL_ADMIN_EMAIL', 'LEARNHOUSE_INITIAL_ADMIN_PASSWORD',
      'LEARNHOUSE_COOKIE_DOMAIN',
    ],
  },
  ai: {
    label: 'AI',
    keys: ['LEARNHOUSE_GEMINI_API_KEY', 'LEARNHOUSE_IS_AI_ENABLED'],
  },
  email: {
    label: 'Email',
    keys: [
      'LEARNHOUSE_EMAIL_PROVIDER', 'LEARNHOUSE_SYSTEM_EMAIL_ADDRESS', 'LEARNHOUSE_RESEND_API_KEY',
      'LEARNHOUSE_SMTP_HOST', 'LEARNHOUSE_SMTP_PORT', 'LEARNHOUSE_SMTP_USERNAME',
      'LEARNHOUSE_SMTP_PASSWORD', 'LEARNHOUSE_SMTP_USE_TLS',
    ],
  },
  s3: {
    label: 'S3 Storage',
    keys: [
      'LEARNHOUSE_CONTENT_DELIVERY_TYPE', 'LEARNHOUSE_S3_API_BUCKET_NAME',
      'LEARNHOUSE_S3_API_ENDPOINT_URL',
    ],
  },
  oauth: {
    label: 'OAuth',
    keys: [
      'LEARNHOUSE_GOOGLE_CLIENT_ID', 'LEARNHOUSE_GOOGLE_CLIENT_SECRET',
    ],
  },
}

// Enterprise services only receive the variables their compose file names
// (no env_file), so only those are offered.
const ENTERPRISE_CATEGORIES: Categories = {
  license: {
    label: 'License & Images',
    keys: ['LEARNHOUSE_LICENSE_KEY', 'EE_IMAGE_TAG'],
  },
  domain: {
    label: 'Domain & TLS',
    keys: ['DOMAIN', 'AGENCY_DOMAIN', 'ACME_EMAIL', 'CLOUDFLARE_API_TOKEN', 'LEARNHOUSE_COOKIE_DOMAIN_ALLOW_BROAD'],
  },
  database: {
    label: 'Database',
    keys: ['LEARNHOUSE_SQL_CONNECTION_STRING', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'],
  },
  security: {
    label: 'Security',
    keys: [
      'LEARNHOUSE_AUTH_JWT_SECRET_KEY', 'COLLAB_INTERNAL_KEY',
      'LEARNHOUSE_INITIAL_ADMIN_EMAIL', 'LEARNHOUSE_INITIAL_ADMIN_PASSWORD',
    ],
  },
}

// Changing these in .env alone does not change the running database: Postgres
// only reads its password when the data volume is first created.
const DB_PASSWORD_KEYS = new Set(['POSTGRES_PASSWORD', 'DB_PASSWORD'])
// Derived URLs and proxy configs are generated from these at setup.
const DERIVED_KEYS = new Set(['LEARNHOUSE_DOMAIN', 'DOMAIN', 'AGENCY_DOMAIN'])

export function isSecret(key: string): boolean {
  const upper = key.toUpperCase()
  return SECRET_PATTERNS.some((pat) => upper.includes(pat))
}

/** Secrets are never shown, not even a prefix: an 8-character password would leak half of itself. */
export function maskValue(key: string, value: string): string {
  if (isSecret(key) && value.length > 0) return '********'
  return value
}

function parseEnv(content: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    map.set(trimmed.slice(0, eqIdx), unquoteEnvValue(trimmed.slice(eqIdx + 1)))
  }
  return map
}

/** Rewrite only the keys that changed, quoted for compose; everything else stays byte-for-byte. */
export function serializeEnv(original: string, updated: Map<string, string>, changed: Set<string>): string {
  const lines = original.split('\n')
  const result: string[] = []
  const written = new Set<string>()

  for (const line of lines) {
    const trimmed = line.trim()
    const eqIdx = trimmed.indexOf('=')
    if (!trimmed || trimmed.startsWith('#') || eqIdx === -1) {
      result.push(line)
      continue
    }
    const key = trimmed.slice(0, eqIdx)
    if (changed.has(key)) {
      result.push(`${key}=${quoteEnvValue(updated.get(key) ?? '')}`)
      written.add(key)
    } else {
      result.push(line)
    }
  }

  // Append any new keys
  for (const key of changed) {
    if (!written.has(key)) {
      result.push(`${key}=${quoteEnvValue(updated.get(key) ?? '')}`)
    }
  }

  return result.join('\n')
}

export async function envCommand() {
  const dir = findInstallDir()
  const config = readConfig(dir)
  if (!config) {
    p.log.error('No LearnHouse installation found. Run setup first.')
    process.exit(1)
  }

  const envPath = path.join(config.installDir, '.env')
  if (!fs.existsSync(envPath)) {
    p.log.error(`No .env file found at ${envPath}`)
    process.exit(1)
  }

  p.intro(pc.cyan('LearnHouse Environment Editor'))

  const categories = config.edition === 'enterprise' ? ENTERPRISE_CATEGORIES : COMMUNITY_CATEGORIES
  const originalContent = fs.readFileSync(envPath, 'utf-8')
  const envMap = parseEnv(originalContent)
  const changed = new Set<string>()

  // Category selection loop
  let editing = true
  while (editing) {
    const category = await p.select({
      message: 'Select a category to edit',
      options: [
        ...Object.entries(categories).map(([value, { label }]) => ({ value, label })),
        { value: '_done', label: pc.dim('Done editing') },
      ],
    })
    if (p.isCancel(category) || category === '_done') {
      editing = false
      break
    }

    const cat = categories[category as string]
    const presentKeys = cat.keys.filter((k) => envMap.has(k))
    const missingKeys = cat.keys.filter((k) => !envMap.has(k))

    if (presentKeys.length === 0 && missingKeys.length === 0) {
      p.log.info('No variables in this category.')
      continue
    }

    // Show current values
    p.log.step(`${cat.label}: Current Values`)
    for (const key of presentKeys) {
      p.log.message(`  ${pc.dim(key)} = ${maskValue(key, envMap.get(key)!)}`)
    }

    // Pick which key to edit
    const keyToEdit = await p.select({
      message: 'Select a variable to edit',
      options: [
        ...presentKeys.map((k) => ({ value: k, label: `${k} = ${maskValue(k, envMap.get(k)!)}` })),
        ...missingKeys.map((k) => ({ value: k, label: `${k} ${pc.dim('(not set)')}` })),
        { value: '_back', label: pc.dim('Back') },
      ],
    })
    if (p.isCancel(keyToEdit) || keyToEdit === '_back') continue

    const key = keyToEdit as string
    const currentValue = envMap.get(key) || ''

    if (DB_PASSWORD_KEYS.has(key)) {
      p.log.warn(
        `${key} is only read when the database volume is first created. Changing it here does not change ` +
        'the running database\'s password, and the app will fail to connect. Change it in Postgres first ' +
        '(ALTER USER ... PASSWORD ...), then here.',
      )
    }
    if (DERIVED_KEYS.has(key)) {
      p.log.warn('The URLs, cookie domain and proxy config were generated from the domain at setup; re-run `npx learnhouse setup` to change the domain everywhere.')
    }

    // Secrets: hidden input, and the current value is never echoed back as a placeholder.
    const newValue = isSecret(key)
      ? await p.password({ message: `New value for ${key} (leave empty to keep the current one)` })
      : await p.text({
          message: `New value for ${key}`,
          placeholder: currentValue,
          defaultValue: currentValue,
          validate: (v) => (/[\r\n]/.test(v) ? 'Value must be a single line' : undefined),
        })
    if (p.isCancel(newValue)) continue
    const value = newValue as string
    if (isSecret(key) && value === '') continue
    if (value === currentValue) continue

    envMap.set(key, value)
    changed.add(key)
    p.log.success(`Updated ${key}`)
  }

  // Write changes
  if (changed.size === 0) {
    p.log.info('No changes made.')
    p.outro(pc.dim('Done'))
    return
  }

  writeFileAtomic(envPath, serializeEnv(originalContent, envMap, changed), 0o600)
  p.log.success('.env file updated')

  // Keep learnhouse.config.json (used by status/health/update) in sync.
  if (changed.has('HTTP_PORT')) {
    const port = parseInt(envMap.get('HTTP_PORT') ?? '', 10)
    if (port > 0 && port < 65536) updateConfig(dir, { httpPort: port })
  }

  const restart = await p.confirm({
    message: 'Restart services to apply changes?',
    initialValue: false,
  })
  if (!p.isCancel(restart) && restart) {
    await applyComposeChanges(config)
  }

  p.outro(pc.dim('Done'))
}
