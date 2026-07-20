import 'server-only'
import { LoopsClient } from 'loops'

// Loops.so contact + event sync. Used to grow the marketing/lifecycle audience
// (e.g. add every new signup to the `signed-users` group, drive onboarding
// email automations from contact properties).
//
// Every function is a no-op returning null when LOOPS_API_KEY is unset, and all
// call sites should treat Loops as fire-and-forget (`.catch(() => {})`): a
// marketing-sync failure must NEVER block or fail a user-facing action.

let _client: LoopsClient | null = null

function client(): LoopsClient | null {
  if (_client) return _client
  const key = process.env.LOOPS_API_KEY
  if (!key) return null
  _client = new LoopsClient(key)
  return _client
}

type ContactProps = Record<string, string | number | boolean | null>
// Loops events disallow null values (unlike contact properties).
type EventProps = Record<string, string | number | boolean>

/** The default lifecycle group new signups land in. */
export const LOOPS_SIGNED_USERS_GROUP = 'signed-users'

/**
 * Create (or upsert) a contact. On Loops a duplicate email is an error, so we
 * fall back to updateContact to make this idempotent.
 */
export async function addContactWithLoops(
  email: string,
  userGroup: string = LOOPS_SIGNED_USERS_GROUP,
  extra?: ContactProps,
): Promise<unknown | null> {
  const c = client()
  if (!c) return null
  try {
    const props: ContactProps = { userGroup, source: 'learnhouse.io', ...(extra || {}) }
    const res = await c.createContact({ email, properties: props })
    // Already exists → update instead so the call is idempotent.
    if ((res as any)?.success === false) {
      return await c.updateContact({ email, properties: props })
    }
    return res
  } catch (err) {
    console.error('[loops] addContact failed:', err)
    return null
  }
}

export async function updateLoopsContact(email: string, properties: ContactProps): Promise<unknown | null> {
  const c = client()
  if (!c) return null
  try {
    return await c.updateContact({ email, properties })
  } catch (err) {
    console.error('[loops] updateContact failed:', err)
    return null
  }
}

export async function deleteLoopsContact(email: string): Promise<unknown | null> {
  const c = client()
  if (!c) return null
  try {
    return await c.deleteContact({ email })
  } catch (err) {
    console.error('[loops] deleteContact failed:', err)
    return null
  }
}

/**
 * Append value(s) to a comma-separated Loops property without clobbering
 * existing entries (e.g. accumulate `use_types` = "teacher,creator" across
 * multiple onboarding steps). Reads the current contact, merges, de-dupes.
 */
export async function appendLoopsContactProperty(
  email: string,
  property: string,
  newValues: string | string[],
): Promise<unknown | null> {
  const c = client()
  if (!c) return null
  try {
    const incoming = Array.isArray(newValues) ? newValues : [newValues]
    let existing: string[] = []
    try {
      const found = (await c.findContact({ email })) as any[]
      const current = found?.[0]?.[property]
      if (typeof current === 'string' && current) existing = current.split(',').map((s) => s.trim())
    } catch {
      // findContact failed — proceed with just the incoming values.
    }
    const merged = Array.from(new Set([...existing, ...incoming].filter(Boolean)))
    return await c.updateContact({ email, properties: { [property]: merged.join(',') } })
  } catch (err) {
    console.error('[loops] appendContactProperty failed:', err)
    return null
  }
}

/**
 * Record an organization ADMIN in the marketing audience.
 *
 * Loops is for the people we market to — org-less signups (prospects) and org
 * ADMINS (the customers/decision-makers) — NOT org members/learners. This
 * upserts the contact, flags it as an org admin (`is_org_admin`) so admins can
 * be segmented, and fires a `became_org_admin` event. Fire-and-forget.
 */
export async function recordOrgAdminInLoops(
  email: string,
  extra?: { orgSlug?: string; firstName?: string; lastName?: string },
): Promise<unknown | null> {
  const props: ContactProps = { is_org_admin: true }
  if (extra?.orgSlug) props.org_slug = extra.orgSlug
  if (extra?.firstName) props.firstName = extra.firstName
  if (extra?.lastName) props.lastName = extra.lastName
  const res = await addContactWithLoops(email, LOOPS_SIGNED_USERS_GROUP, props)
  await sendLoopsEvent(email, 'became_org_admin', extra?.orgSlug ? { org_slug: extra.orgSlug } : undefined)
  return res
}

export async function sendLoopsEvent(
  email: string,
  eventName: string,
  eventProperties?: EventProps,
): Promise<unknown | null> {
  const c = client()
  if (!c) return null
  try {
    return await c.sendEvent({ email, eventName, eventProperties })
  } catch (err) {
    console.error('[loops] sendEvent failed:', err)
    return null
  }
}
