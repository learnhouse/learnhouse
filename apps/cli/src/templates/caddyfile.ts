import type { SetupConfig } from '../types.js'

export function generateCaddyfile(config: SetupConfig): string {
  const email = config.sslEmail || 'admin@example.com'

  return `{
  email ${email}
}

www.${config.domain} {
  redir https://${config.domain}{uri} permanent
}

${config.domain} {
  reverse_proxy learnhouse-app:80
}
`
}
