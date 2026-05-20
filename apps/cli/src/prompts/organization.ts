import * as p from '../utils/prompt.js'
import { validateRequired } from '../utils/validators.js'

export interface OrgConfig {
  orgName: string
  orgSlug: string
}

export async function promptOrganization(): Promise<OrgConfig> {
  const orgName = await p.text({
    message: 'Organization name?',
    placeholder: 'My School',
    defaultValue: 'My School',
    validate: validateRequired,
  })
  if (p.isCancel(orgName)) { p.cancel(); process.exit(0) }

  // Slug defaults to "default" — the value the published API image hard-codes
  // until the LEARNHOUSE_INITIAL_ORG_SLUG-aware build ships. Users can opt
  // into a custom slug, but the prompt doesn't push them off the safe path.
  const orgSlug = await p.text({
    message: 'Organization slug? (used in URLs like /orgs/<slug> — keep "default" unless you know you need to change it)',
    placeholder: 'default',
    defaultValue: 'default',
    validate: (value) => {
      if (!value) return 'Slug is required'
      if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]?$/.test(value)) {
        return 'Lowercase letters, numbers and hyphens only'
      }
      return undefined
    },
  })
  if (p.isCancel(orgSlug)) { p.cancel(); process.exit(0) }

  return {
    orgName: orgName as string,
    orgSlug: (orgSlug as string).toLowerCase(),
  }
}
