const RESERVED_TLDS = new Set([
  'local',
  'localhost',
  'test',
  'invalid',
  'example',
])

// RFC 2606 reserved second-level domains. The LearnHouse seeder rejects these,
// silently leaving the install with no admin user, so the CLI must too.
const RESERVED_DOMAINS = new Set([
  'example.com',
  'example.net',
  'example.org',
])

export function validateEmail(value: string): string | undefined {
  if (!value) return 'Email is required'
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!re.test(value)) return 'Please enter a valid email address'
  const domain = value.slice(value.lastIndexOf('@') + 1).toLowerCase()
  // Same label rules as a hostname: no empty labels (a@b..com), no leading/trailing hyphens
  if (!domain.split('.').every((l) => /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(l))) {
    return 'Please enter a valid email address'
  }
  const tld = domain.includes('.') ? domain.slice(domain.lastIndexOf('.') + 1) : domain
  if (RESERVED_TLDS.has(tld)) {
    return `Reserved TLD ".${tld}" is not accepted. Use a real domain (e.g. admin@yourdomain.com).`
  }
  if (RESERVED_DOMAINS.has(domain)) {
    return `Reserved domain "${domain}" is not accepted; the seeder would create no admin. Use a real domain.`
  }
  return undefined
}

export function validatePassword(value: string): string | undefined {
  if (!value) return 'Password is required'
  if (value.length < 8) return 'Password must be at least 8 characters'
  return undefined
}

export function validateDomain(value: string): string | undefined {
  if (!value) return 'Domain is required'
  // Allow localhost or valid domain names
  if (value === 'localhost') return undefined
  const re = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/
  if (!re.test(value)) return 'Please enter a valid domain (e.g., learnhouse.example.com)'
  if (value.length > 253 || value.split('.').some((l) => l.length > 63)) {
    return 'Domain is too long (max 253 characters, 63 per label)'
  }
  return undefined
}

export function validatePort(value: string): string | undefined {
  // Require pure digits; parseInt would otherwise accept "8080abc" as 8080.
  if (!/^\d+$/.test(value.trim())) return 'Port must be between 1 and 65535'
  const num = parseInt(value, 10)
  if (num < 1 || num > 65535) return 'Port must be between 1 and 65535'
  return undefined
}

export function validateSlug(value: string): string | undefined {
  if (!value) return 'Slug is required'
  const re = /^[a-z0-9]+(-[a-z0-9]+)*$/
  if (!re.test(value)) return 'Slug must be lowercase alphanumeric with hyphens only'
  // The slug is used as a subdomain label, so it must fit in one (63 chars).
  if (value.length > 63) return 'Slug must be at most 63 characters'
  return undefined
}

export function validateRequired(value: string): string | undefined {
  if (!value || value.trim() === '') return 'This field is required'
  return undefined
}

/**
 * Installation names become a directory under ~/.learnhouse, so they must be a
 * single plain path segment: no separators, no `.`/`..`, nothing a shell or
 * a compose file would interpret.
 */
export function validateInstallName(value: string): string | undefined {
  if (!value) return 'Name is required'
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(value)) {
    return 'Name must start with a letter or digit and use only letters, digits, ".", "_" or "-" (max 64)'
  }
  return undefined
}

export function validatePostgresUrl(value: string): string | undefined {
  if (!/^postgres(ql)?(\+\w+)?:\/\//.test(value)) return 'Must start with postgresql:// (or postgres://)'
  return undefined
}

export function validateRedisUrl(value: string): string | undefined {
  if (!/^rediss?:\/\//.test(value)) return 'Must start with redis:// or rediss://'
  return undefined
}

/** Image tags we accept from `--to` / EE_IMAGE_TAG / a release lookup: a
 *  docker tag, nothing that could break out of the compose `image:` line or
 *  the .env entry. */
export const IMAGE_TAG_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/
