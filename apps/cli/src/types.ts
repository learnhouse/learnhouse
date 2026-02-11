export interface SetupConfig {
  // Deployment
  deploymentId: string
  installDir: string

  // Domain
  domain: string
  useHttps: boolean
  httpPort: number

  // Organization
  orgName: string

  // Admin
  adminEmail: string
  adminPassword: string

  // Optional Features
  aiEnabled: boolean
  openaiApiKey?: string
  emailEnabled: boolean
  resendApiKey?: string
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
  orgSlug: string
}
