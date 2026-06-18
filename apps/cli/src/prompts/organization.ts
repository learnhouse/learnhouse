import * as p from '../utils/prompt.js'
import { validateRequired, validateSlug } from '../utils/validators.js'

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
    // Use the canonical slug rule (rejects leading/trailing/double hyphens) so
    // the wizard can't accept a slug the API seeder / URLs would choke on.
    validate: validateSlug,
  })
  if (p.isCancel(orgSlug)) { p.cancel(); process.exit(0) }

  return {
    orgName: orgName as string,
    orgSlug: (orgSlug as string).toLowerCase(),
  }
}
