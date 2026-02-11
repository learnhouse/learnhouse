import * as p from '@clack/prompts'
import { validateDomain, validateEmail, validatePort } from '../utils/validators.js'

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

  const defaultPort = autoSsl ? 443 : 80
  const portMessage = autoSsl
    ? 'HTTPS port? (Caddy needs 443 for auto SSL, and will also listen on 80 for redirect)'
    : 'HTTP port for the web server?'

  const port = await p.text({
    message: portMessage,
    placeholder: String(defaultPort),
    defaultValue: String(defaultPort),
    validate: validatePort,
  })
  if (p.isCancel(port)) { p.cancel(); process.exit(0) }

  return {
    domain: domain as string,
    useHttps,
    httpPort: parseInt(port as string, 10),
    autoSsl,
    sslEmail,
  }
}
