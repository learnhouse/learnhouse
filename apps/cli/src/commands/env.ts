import fs from 'node:fs'
import path from 'node:path'
import * as p from '@clack/prompts'
import pc from 'picocolors'
import { findInstallDir, readConfig } from '../services/config-store.js'
import { dockerComposeDown, dockerComposeUp } from '../services/docker.js'

const SECRET_PATTERNS = ['PASSWORD', 'SECRET', 'API_KEY', 'CLIENT_SECRET']

const CATEGORIES: Record<string, { label: string; keys: string[] }> = {
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
    keys: ['LEARNHOUSE_RESEND_API_KEY', 'LEARNHOUSE_SYSTEM_EMAIL_ADDRESS'],
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
      'NEXT_PUBLIC_UNSPLASH_ACCESS_KEY',
    ],
  },
}

function isSecret(key: string): boolean {
  const upper = key.toUpperCase()
  return SECRET_PATTERNS.some((pat) => upper.includes(pat))
}

function maskValue(key: string, value: string): string {
  if (isSecret(key) && value.length > 0) {
    return value.slice(0, 4) + '****'
  }
  return value
}

function parseEnv(content: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    map.set(trimmed.slice(0, eqIdx), trimmed.slice(eqIdx + 1))
  }
  return map
}

function serializeEnv(original: string, updated: Map<string, string>): string {
  const lines = original.split('\n')
  const result: string[] = []
  const written = new Set<string>()

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) {
      result.push(line)
      continue
    }
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) {
      result.push(line)
      continue
    }
    const key = trimmed.slice(0, eqIdx)
    if (updated.has(key)) {
      result.push(`${key}=${updated.get(key)}`)
      written.add(key)
    } else {
      result.push(line)
    }
  }

  // Append any new keys
  for (const [key, value] of updated) {
    if (!written.has(key)) {
      result.push(`${key}=${value}`)
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

  const originalContent = fs.readFileSync(envPath, 'utf-8')
  const envMap = parseEnv(originalContent)

  // Category selection loop
  let editing = true
  while (editing) {
    const category = await p.select({
      message: 'Select a category to edit',
      options: [
        ...Object.entries(CATEGORIES).map(([value, { label }]) => ({ value, label })),
        { value: '_done', label: pc.dim('Done editing') },
      ],
    })
    if (p.isCancel(category) || category === '_done') {
      editing = false
      break
    }

    const cat = CATEGORIES[category as string]
    const presentKeys = cat.keys.filter((k) => envMap.has(k))
    const missingKeys = cat.keys.filter((k) => !envMap.has(k))

    if (presentKeys.length === 0 && missingKeys.length === 0) {
      p.log.info('No variables in this category.')
      continue
    }

    // Show current values
    p.log.step(`${cat.label} — Current Values`)
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

    const newValue = await p.text({
      message: `New value for ${key}`,
      placeholder: currentValue,
      defaultValue: currentValue,
    })
    if (p.isCancel(newValue)) continue

    envMap.set(key, newValue as string)
    p.log.success(`Updated ${key}`)
  }

  // Write changes
  const newContent = serializeEnv(originalContent, envMap)
  if (newContent !== originalContent) {
    fs.writeFileSync(envPath, newContent)
    p.log.success('.env file updated')

    const restart = await p.confirm({
      message: 'Restart services to apply changes?',
      initialValue: false,
    })
    if (!p.isCancel(restart) && restart) {
      const s = p.spinner()
      s.start('Restarting services')
      try {
        dockerComposeDown(config.installDir)
        dockerComposeUp(config.installDir)
        s.stop('Services restarted')
      } catch {
        s.stop('Restart failed')
        p.log.error('Failed to restart services. Check Docker output above.')
      }
    }
  } else {
    p.log.info('No changes made.')
  }

  p.outro(pc.dim('Done'))
}
