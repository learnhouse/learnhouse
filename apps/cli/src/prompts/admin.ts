import * as p from '@clack/prompts'
import { validateEmail, validatePassword } from '../utils/validators.js'

export interface AdminConfig {
  adminEmail: string
  adminPassword: string
}

export async function promptAdmin(): Promise<AdminConfig> {
  const email = await p.text({
    message: 'Admin email address?',
    placeholder: 'admin@example.com',
    validate: validateEmail,
  })
  if (p.isCancel(email)) { p.cancel(); process.exit(0) }

  const password = await p.password({
    message: 'Admin password? (min 8 characters)',
    validate: validatePassword,
  })
  if (p.isCancel(password)) { p.cancel(); process.exit(0) }

  return {
    adminEmail: email as string,
    adminPassword: password as string,
  }
}
