import * as p from '../utils/prompt.js'
import pc from 'picocolors'
import { validateDomain, validateEmail, validatePort } from '../utils/validators.js'
import { checkPort, findAvailablePort } from './../utils/network.js'

export interface DomainConfig {
  domain: string
  useHttps: boolean
  httpPort: number
  autoSsl: boolean
  sslEmail?: string
}

export async function promptDomain(): Promise<DomainConfig> {
  const domain = await p.text({
    message: 'What domain will LearnHouse be hosted on?',
    placeholder: 'localhost',
    defaultValue: 'localhost',
    validate: validateDomain,
  })
  if (p.isCancel(domain)) { p.cancel(); process.exit(0) }

  let useHttps = false
  let autoSsl = false
  let sslEmail: string | undefined

  if (domain !== 'localhost') {
    const httpsChoice = await p.select({
      message: 'HTTPS configuration?',
      options: [
        { value: 'auto', label: 'Automatic SSL (Let\'s Encrypt via Caddy)', hint: 'recommended' },
        { value: 'manual', label: 'I\'ll handle SSL myself (reverse proxy, Cloudflare, etc.)' },
        { value: 'none', label: 'No HTTPS (HTTP only)', hint: 'not recommended for production' },
      ],
    })
    if (p.isCancel(httpsChoice)) { p.cancel(); process.exit(0) }

    if (httpsChoice === 'auto') {
      useHttps = true
      autoSsl = true
      const email = await p.text({
        message: 'Email for Let\'s Encrypt notifications?',
        placeholder: 'admin@example.com',
        validate: validateEmail,
      })
      if (p.isCancel(email)) { p.cancel(); process.exit(0) }
      sslEmail = email as string
    } else if (httpsChoice === 'manual') {
      useHttps = true
    }
  }

  // Pick a sensible default port. If the canonical default (80 or 443) is
  // already in use we suggest the first available alternative (8080, 8000…)
  // so the wizard doesn't hand the user a config that will fail on `up`.
  const canonicalDefault = autoSsl ? 443 : 80
  let defaultPort = canonicalDefault
  if (!autoSsl) {
    const available = await findAvailablePort(canonicalDefault)
    if (available && available !== canonicalDefault) {
      p.log.warn(`Port ${canonicalDefault} is already in use. Suggesting ${pc.cyan(String(available))} instead.`)
      defaultPort = available
    } else if (!available) {
      p.log.warn('Could not find a free common port. You will need to enter one manually.')
    }
  }

  const portMessage = autoSsl
    ? 'HTTPS port? (Caddy needs 443 for auto SSL, and will also listen on 80 for redirect)'
    : 'HTTP port for the web server?'

  let httpPort = 0
  while (httpPort === 0) {
    const port = await p.text({
      message: portMessage,
      placeholder: String(defaultPort),
      defaultValue: String(defaultPort),
      validate: validatePort,
    })
    if (p.isCancel(port)) { p.cancel(); process.exit(0) }
    const parsed = parseInt(port as string, 10)
    // Only re-check non-privileged ports here — privileged ports (≤1024) might
    // be bound by a system service that the wizard can't see from user space,
    // but Docker can still publish to them; trust the user in that case.
    if (parsed > 1024 && !(await checkPort(parsed))) {
      p.log.warn(`Port ${parsed} is already in use. Pick another.`)
      continue
    }
    httpPort = parsed
  }

  return {
    domain: domain as string,
    useHttps,
    httpPort,
    autoSsl,
    sslEmail,
  }
}
