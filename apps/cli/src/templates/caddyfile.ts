import type { SetupConfig } from '../types.js'

export function generateCaddyfile(config: SetupConfig): string {
  const email = config.sslEmail || 'admin@example.com'

  return `{
  email ${email}
}

${config.domain} {
  handle /collab* {
    reverse_proxy learnhouse-collab:4000
  }
  handle {
    reverse_proxy learnhouse-app:3000
  }
}
`
}
