'use client'
import OpenSignUpComponent from './OpenSignup'

interface InviteOnlySignUpProps {
  inviteCode: string
  org?: any
}

/**
 * Signup into an invite-only org with an invite code: the same one-screen form
 * as open signup, posting through the invite-code endpoint (and handing the
 * code to a Google sign-up).
 */
export default function InviteOnlySignUpComponent({ inviteCode, org }: InviteOnlySignUpProps) {
  return <OpenSignUpComponent org={org} inviteCode={inviteCode} />
}
