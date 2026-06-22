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
  const tld = domain.includes('.') ? domain.slice(domain.lastIndexOf('.') + 1) : domain
  if (RESERVED_TLDS.has(tld)) {
    return `Reserved TLD ".${tld}" is not accepted. Use a real domain (e.g. admin@yourdomain.com).`
  }
  if (RESERVED_DOMAINS.has(domain)) {
    return `Reserved domain "${domain}" is not accepted — the seeder would create no admin. Use a real domain.`
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
  return undefined
}

export function validatePort(value: string): string | undefined {
  // Require pure digits — parseInt would otherwise accept "8080abc" as 8080.
  if (!/^\d+$/.test(value.trim())) return 'Port must be between 1 and 65535'
  const num = parseInt(value, 10)
  if (num < 1 || num > 65535) return 'Port must be between 1 and 65535'
  return undefined
}

export function validateSlug(value: string): string | undefined {
  if (!value) return 'Slug is required'
  const re = /^[a-z0-9]+(-[a-z0-9]+)*$/
  if (!re.test(value)) return 'Slug must be lowercase alphanumeric with hyphens only'
  return undefined
}

export function validateRequired(value: string): string | undefined {
  if (!value || value.trim() === '') return 'This field is required'
  return undefined
}
