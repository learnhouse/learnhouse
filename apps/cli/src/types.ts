export type Edition = 'community' | 'enterprise'
export type EeTenancy = 'single' | 'agency'

export interface SetupConfig {
  // Deployment
  deploymentId: string
  installDir: string
  channel: 'stable' | 'dev'

  // Edition (Community is the default; Enterprise unlocks the licensed stack)
  edition?: Edition
  // Enterprise-only:
  licenseKey?: string
  eeTenancy?: EeTenancy
  eeImageTag?: string
  eeLocalTls?: boolean
  acmeEmail?: string
  // External database (skip the in-container Postgres)
  externalDbUrl?: string
  // Cloudflare DNS-01 (for wildcard certs on *.domain) + IPv6 compose network
  dnsProvider?: 'cloudflare'
  cfApiToken?: string
  dockerIpv6?: boolean

  // Domain & SSL
  domain: string
  useHttps: boolean
  httpPort: number
  autoSsl: boolean
  sslEmail?: string

  // Database
  useExternalDb: boolean
  externalDbConnectionString?: string
  dbPassword?: string
  useAiDatabase: boolean

  // Redis
  useExternalRedis: boolean
  externalRedisConnectionString?: string

  // Organization
  orgName: string
  orgSlug: string

  // Admin
  adminEmail: string
  adminPassword: string

  // Optional Features
  aiEnabled: boolean
  geminiApiKey?: string
  emailEnabled: boolean
  emailProvider?: 'resend' | 'smtp'
  resendApiKey?: string
  smtpHost?: string
  smtpPort?: number
  smtpUsername?: string
  smtpPassword?: string
  smtpUseTls?: boolean
  systemEmailAddress?: string
  s3Enabled: boolean
  s3BucketName?: string
  s3EndpointUrl?: string
  googleOAuthEnabled: boolean
  googleClientId?: string
  googleClientSecret?: string
  unsplashEnabled: boolean
  unsplashAccessKey?: string
}

export interface LearnHouseConfigJson {
  version: string
  deploymentId: string
  createdAt: string
  installDir: string
  domain: string
  httpPort: number
  useHttps: boolean
  autoSsl: boolean
  useExternalDb: boolean
  orgSlug: string
  // Enterprise metadata (absent/`community` for the OSS stack)
  edition?: Edition
  eeTenancy?: EeTenancy
  eeLocalTls?: boolean
}
