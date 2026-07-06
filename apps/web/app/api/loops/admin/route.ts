import { NextRequest, NextResponse } from 'next/server'
import { isSaaSMode } from '@lib/saas'
import { getServerSession } from '@lib/auth/server'
import { recordOrgAdminInLoops, updateLoopsContact } from '@services/emails/loops'

// POST /api/loops/admin
// Add the authenticated user to the marketing audience (Loops) as an ORG ADMIN
// — called when a user becomes an admin, e.g. right after creating an org.
//
// SaaS-only and fire-and-forget. The email is taken from the VERIFIED session
// (never the request body), so this can't be used to inject arbitrary contacts.
// The body only carries the org slug as metadata.
export async function POST(request: NextRequest) {
  if (!(await isSaaSMode())) {
    return NextResponse.json({ ok: false }, { status: 404 })
  }

  const session = await getServerSession()
  const email = session?.user?.email
  if (!email) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }

  let orgSlug: string | undefined
  let onboarding: Record<string, unknown> | null = null
  try {
    const body = await request.json()
    if (typeof body?.orgSlug === 'string') orgSlug = body.orgSlug
    if (body?.onboarding && typeof body.onboarding === 'object') onboarding = body.onboarding
  } catch {
    // body is optional
  }

  void recordOrgAdminInLoops(email, {
    orgSlug,
    firstName: session?.user?.first_name || undefined,
    lastName: session?.user?.last_name || undefined,
  }).catch(() => {})

  // Onboarding choices → Loops contact properties (use_types, chosen_plans,
  // personal_goals, onboarding_completed, …) for segmentation. Only string /
  // number / boolean values are kept.
  if (onboarding) {
    const props: Record<string, string | number | boolean> = {}
    for (const [k, v] of Object.entries(onboarding)) {
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') props[k] = v
    }
    if (Object.keys(props).length) void updateLoopsContact(email, props).catch(() => {})
  }

  return NextResponse.json({ ok: true })
}
