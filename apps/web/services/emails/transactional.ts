import 'server-only'
import { send } from './resend'

// Non-billing transactional emails (welcome, contact). Same never-throw contract
// as the billing mails: fire-and-forget, no-op without RESEND_API_KEY.

export async function sendWelcomeAccountMail(args: { email: string; username?: string }): Promise<void> {
  const { email, username } = args
  await send(email, 'Welcome to LearnHouse 👋', {
    accentColor: '#171717',
    heading: 'Welcome to LearnHouse!',
    subtitle: username
      ? `Hey ${username}, we're thrilled to have you on board.`
      : "We're thrilled to have you on board.",
    body: "You're ready to build and share courses. Here's how to get the most out of it:",
    bulletPoints: [
      'Create your first course and add content in minutes.',
      'Invite learners and track their progress.',
      'Brand your school and share it with the world.',
    ],
    cta: { label: 'Get started', href: 'https://www.learnhouse.io/home' },
  })
}

export async function sendContactMail(args: {
  fromEmail: string
  name?: string
  message: string
  to?: string
}): Promise<void> {
  const { fromEmail, name, message, to } = args
  await send(to || 'hello@learnhouse.app', `New contact form message from ${name || fromEmail}`, {
    accentColor: '#171717',
    heading: 'New contact message',
    subtitle: `From ${name ? `${name} · ` : ''}${fromEmail}`,
    body: message,
  })
}
