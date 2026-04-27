import * as p from '../utils/prompt.js'
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

    const provider = await p.select({
      message: 'S3 provider?',
      options: [
        { value: 'aws', label: 'AWS S3', hint: 'Default — no endpoint URL needed' },
        { value: 'wasabi', label: 'Wasabi', hint: 'S3-compatible' },
        { value: 'custom', label: 'Other (S3-compatible)', hint: 'MinIO, Cloudflare R2, Backblaze B2, etc.' },
      ],
      initialValue: 'aws',
    })
    if (p.isCancel(provider)) { p.cancel(); process.exit(0) }

    const bucket = await p.text({
      message: 'S3 bucket name?',
      validate: validateRequired,
    })
    if (p.isCancel(bucket)) { p.cancel(); process.exit(0) }
    config.s3BucketName = bucket as string

    if (provider === 'wasabi') {
      p.log.info('Region URLs: https://docs.wasabi.com/docs/what-are-the-service-urls-for-wasabi-s-different-storage-regions')
      const region = await p.select({
        message: 'Wasabi region?',
        options: [
          { value: 'us-east-1', label: 'US East 1 (N. Virginia)' },
          { value: 'us-east-2', label: 'US East 2 (N. Virginia)' },
          { value: 'us-central-1', label: 'US Central 1 (Texas)' },
          { value: 'us-west-1', label: 'US West 1 (Oregon)' },
          { value: 'us-west-2', label: 'US West 2 (San Jose)' },
          { value: 'ca-central-1', label: 'CA Central 1 (Toronto)' },
          { value: 'eu-central-1', label: 'EU Central 1 (Amsterdam)' },
          { value: 'eu-central-2', label: 'EU Central 2 (Frankfurt)' },
          { value: 'eu-west-1', label: 'EU West 1 (United Kingdom)' },
          { value: 'eu-west-2', label: 'EU West 2 (Paris)' },
          { value: 'eu-west-3', label: 'EU West 3 (United Kingdom)' },
          { value: 'eu-south-1', label: 'EU South 1 (Milan)' },
          { value: 'ap-northeast-1', label: 'AP Northeast 1 (Tokyo)' },
          { value: 'ap-northeast-2', label: 'AP Northeast 2 (Osaka)' },
          { value: 'ap-southeast-1', label: 'AP Southeast 1 (Singapore)' },
          { value: 'ap-southeast-2', label: 'AP Southeast 2 (Sydney)' },
        ],
        initialValue: 'us-east-1',
      })
      if (p.isCancel(region)) { p.cancel(); process.exit(0) }
      config.s3EndpointUrl = `https://s3.${region}.wasabisys.com`
    } else if (provider === 'custom') {
      const endpoint = await p.text({
        message: 'S3 endpoint URL?',
        placeholder: 'https://s3.example.com',
        validate: validateRequired,
      })
      if (p.isCancel(endpoint)) { p.cancel(); process.exit(0) }
      config.s3EndpointUrl = endpoint as string
    }

    p.log.info('Tip: AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY must be set in your environment for S3 to work (skip if using AWS IAM roles).')
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
