import * as p from '../utils/prompt.js'
import { validateRequired } from '../utils/validators.js'

export interface OrgConfig {
  orgName: string
}

export async function promptOrganization(): Promise<OrgConfig> {
  const orgName = await p.text({
    message: 'Organization name?',
    placeholder: 'My School',
    defaultValue: 'My School',
    validate: validateRequired,
  })
  if (p.isCancel(orgName)) { p.cancel(); process.exit(0) }

  return {
    orgName: orgName as string,
  }
}
