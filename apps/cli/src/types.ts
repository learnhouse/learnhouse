export interface SetupConfig {
  // Deployment
  deploymentId: string
  installDir: string

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

  // Redis
  useExternalRedis: boolean
  externalRedisConnectionString?: string

  // Organization
  orgName: string

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
}
