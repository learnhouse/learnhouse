import * as p from '@clack/prompts'
import { validateDomain, validatePort } from '../utils/validators.js'

export interface DomainConfig {
  domain: string
  useHttps: boolean
  httpPort: number
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
  if (domain !== 'localhost') {
    const https = await p.confirm({
      message: 'Will you use HTTPS?',
      initialValue: true,
    })
    if (p.isCancel(https)) { p.cancel(); process.exit(0) }
    useHttps = https
  }

  const defaultPort = useHttps ? 443 : 80
  const port = await p.text({
    message: 'HTTP port for the web server?',
    placeholder: String(defaultPort),
    defaultValue: String(defaultPort),
    validate: validatePort,
  })
  if (p.isCancel(port)) { p.cancel(); process.exit(0) }

  return {
    domain: domain as string,
    useHttps,
    httpPort: parseInt(port as string, 10),
  }
}
