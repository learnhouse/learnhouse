import * as p from '@clack/prompts'
import { validateRequired } from '../utils/validators.js'

export interface FeaturesConfig {
  aiEnabled: boolean
  geminiApiKey?: string
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

export async function promptFeatures(): Promise<FeaturesConfig> {
  const selected = await p.multiselect({
    message: 'Enable optional features? (Space to toggle, Enter to confirm)',
    options: [
      { value: 'ai', label: 'AI Features (Gemini)' },
      { value: 'email', label: 'Email (Resend)' },
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
    p.log.info('Configure Email (Resend)')
    const key = await p.text({
      message: 'Resend API key?',
      placeholder: 're_...',
      validate: validateRequired,
    })
    if (p.isCancel(key)) { p.cancel(); process.exit(0) }
    config.resendApiKey = key as string

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
