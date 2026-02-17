import * as p from '@clack/prompts'
import { validateRequired } from '../utils/validators.js'

export interface FeaturesConfig {
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

export async function promptFeatures(): Promise<FeaturesConfig> {
  const selected = await p.multiselect({
    message: 'Enable optional features? (Space to toggle, Enter to confirm)',
    options: [
      { value: 'ai', label: 'AI Features (Gemini)' },
      { value: 'email', label: 'Email (Resend or SMTP)' },
      { value: 's3', label: 'S3 Storage' },
      { value: 'google', label: 'Google OAuth' },
      { value: 'unsplash', label: 'Unsplash Images' },
    ],
    required: false,
  })
  if (p.isCancel(selected)) { p.cancel(); process.exit(0) }

  const features = selected as string[]
  const config: FeaturesConfig = {
    aiEnabled: features.includes('ai'),
    emailEnabled: features.includes('email'),
    s3Enabled: features.includes('s3'),
    googleOAuthEnabled: features.includes('google'),
    unsplashEnabled: features.includes('unsplash'),
  }

  if (config.aiEnabled) {
    p.log.info('Configure AI (Gemini)')
    const key = await p.text({
      message: 'Gemini API key?',
      placeholder: 'AIza...',
      validate: validateRequired,
    })
    if (p.isCancel(key)) { p.cancel(); process.exit(0) }
    config.geminiApiKey = key as string
  }

  if (config.emailEnabled) {
    const provider = await p.select({
      message: 'Email provider?',
      options: [
        { value: 'smtp', label: 'SMTP (any provider)' },
        { value: 'resend', label: 'Resend' },
      ],
    })
    if (p.isCancel(provider)) { p.cancel(); process.exit(0) }
    config.emailProvider = provider as 'resend' | 'smtp'

    if (config.emailProvider === 'resend') {
      p.log.info('Configure Email (Resend)')
      const key = await p.text({
        message: 'Resend API key?',
        placeholder: 're_...',
        validate: validateRequired,
      })
      if (p.isCancel(key)) { p.cancel(); process.exit(0) }
      config.resendApiKey = key as string
    } else {
      p.log.info('Configure Email (SMTP)')
      const host = await p.text({
        message: 'SMTP host?',
        placeholder: 'smtp.gmail.com',
        validate: validateRequired,
      })
      if (p.isCancel(host)) { p.cancel(); process.exit(0) }
      config.smtpHost = host as string

      const port = await p.text({
        message: 'SMTP port?',
        initialValue: '587',
        validate: validateRequired,
      })
      if (p.isCancel(port)) { p.cancel(); process.exit(0) }
      config.smtpPort = parseInt(port as string, 10)

      const username = await p.text({
        message: 'SMTP username?',
        validate: validateRequired,
      })
      if (p.isCancel(username)) { p.cancel(); process.exit(0) }
      config.smtpUsername = username as string

      const password = await p.password({
        message: 'SMTP password?',
        validate: validateRequired,
      })
      if (p.isCancel(password)) { p.cancel(); process.exit(0) }
      config.smtpPassword = password as string

      const useTls = await p.confirm({
        message: 'Use TLS?',
        initialValue: true,
      })
      if (p.isCancel(useTls)) { p.cancel(); process.exit(0) }
      config.smtpUseTls = useTls as boolean
    }

    const email = await p.text({
      message: 'System email address (From)?',
      placeholder: 'noreply@yourdomain.com',
      validate: validateRequired,
    })
    if (p.isCancel(email)) { p.cancel(); process.exit(0) }
    config.systemEmailAddress = email as string
  }

  if (config.s3Enabled) {
    p.log.info('Configure S3 Storage')
    const bucket = await p.text({
      message: 'S3 bucket name?',
      validate: validateRequired,
    })
    if (p.isCancel(bucket)) { p.cancel(); process.exit(0) }
    config.s3BucketName = bucket as string

    const endpoint = await p.text({
      message: 'S3 endpoint URL? (leave empty for AWS S3)',
      placeholder: 'https://s3.amazonaws.com',
    })
    if (p.isCancel(endpoint)) { p.cancel(); process.exit(0) }
    if (endpoint) config.s3EndpointUrl = endpoint as string
  }

  if (config.googleOAuthEnabled) {
    p.log.info('Configure Google OAuth')
    const clientId = await p.text({
      message: 'Google Client ID?',
      validate: validateRequired,
    })
    if (p.isCancel(clientId)) { p.cancel(); process.exit(0) }
    config.googleClientId = clientId as string

    const clientSecret = await p.text({
      message: 'Google Client Secret?',
      validate: validateRequired,
    })
    if (p.isCancel(clientSecret)) { p.cancel(); process.exit(0) }
    config.googleClientSecret = clientSecret as string
  }

  if (config.unsplashEnabled) {
    p.log.info('Configure Unsplash')
    const key = await p.text({
      message: 'Unsplash Access Key?',
      validate: validateRequired,
    })
    if (p.isCancel(key)) { p.cancel(); process.exit(0) }
    config.unsplashAccessKey = key as string
  }

  return config
}
