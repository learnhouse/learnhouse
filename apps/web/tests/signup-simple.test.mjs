import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { inviteSignInHref, inviteTokenFrom, splitFullName, usernameFromEmail } from '../lib/auth/signup.ts'

// Signup is one screen, invitation links land on the org's own page, and the
// password rules stay in step with the API.
const root = join(import.meta.dir, '..')
const read = (p) => readFileSync(join(root, p), 'utf8')

describe('signup helpers', () => {
  test('one optional name field splits into first and last name', () => {
    expect(splitFullName('  Ada   King Lovelace ')).toEqual({ first_name: 'Ada', last_name: 'King Lovelace' })
    expect(splitFullName('Cher')).toEqual({ first_name: 'Cher', last_name: '' })
    expect(splitFullName('')).toEqual({ first_name: '', last_name: '' })
    expect(splitFullName(undefined)).toEqual({ first_name: '', last_name: '' })
  })

  test('the username is made from the email', () => {
    expect(usernameFromEmail('Jane.Doe+x@school.dev', () => 0)).toBe('janedoex1000')
    expect(usernameFromEmail('al@x.io', () => 0.9999)).toBe('aluser9999')
    expect(usernameFromEmail('', () => 0)).toBe('user1000')
  })

  test('only a well-formed invitation token is used', () => {
    const tok = 'A'.repeat(43)
    expect(inviteTokenFrom(tok)).toBe(tok)
    expect(inviteTokenFrom(` ${tok} `)).toBe(tok)
    expect(inviteTokenFrom('short')).toBeNull()
    expect(inviteTokenFrom(`${tok}<script>`)).toBeNull()
    expect(inviteTokenFrom(null)).toBeNull()
  })

  test('existing accounts sign in on the org page and come back to the invitation', () => {
    expect(inviteSignInHref('tok_123')).toBe('/login?next=%2Fsignup%3Finvite%3Dtok_123')
  })
})

describe('one-screen signup', () => {
  const form = read('app/auth/signup/OpenSignup.tsx')

  test('no username or bio field, an optional name, a show-password toggle', () => {
    expect(form).not.toContain('name="username"')
    expect(form).not.toContain('name="bio"')
    expect(form).toContain('name="name"')
    expect(form).toContain("t('common.optional')")
    expect(form).toContain('<PasswordInput')
    expect(form).toContain('usernameFromEmail(email)')
  })

  test('invite-code signup reuses the same form', () => {
    const inviteOnly = read('app/auth/signup/InviteOnlySignUp.tsx')
    expect(inviteOnly).toContain('<OpenSignUpComponent org={org} inviteCode={inviteCode} />')
  })

  test('the password rules mirror the API list', () => {
    const web = read('components/Auth/PasswordStrengthIndicator.tsx')
    const api = readFileSync(join(root, '../api/src/services/security/password_validation.py'), 'utf8')
    const words = (src, start, end) => new Set(src.slice(src.indexOf(start), src.indexOf(end, src.indexOf(start))).match(/['"]([^'"]+)['"]/g).map((w) => w.slice(1, -1)))
    expect(words(web, 'COMMON_PASSWORDS = new Set([', '])')).toEqual(words(api, 'COMMON_PASSWORDS = frozenset({', '})'))
    for (const key of ['password_req_min_length', 'password_req_letter', 'password_req_number_or_symbol', 'password_req_not_common']) {
      expect(web).toContain(`auth.${key}`)
    }
    expect(web).not.toContain('password_req_uppercase')
  })
})

describe('invitation links', () => {
  test('?invite= opens the invitation on the org page, before any other signup mode', () => {
    const page = read('app/auth/signup/signup.tsx')
    expect(page).toContain("inviteTokenFrom(searchParams.get('invite'))")
    expect(page).toContain('<InviteLinkSignup token={inviteLinkToken} org={props.org} />')
    // Never bounced to /new or the hub while an invitation is open.
    expect(page).toContain('!hasOrgToJoin && !inviteLinkToken')
  })

  test('the invite page never links to the platform hub or org creation', () => {
    const invite = read('app/auth/signup/InviteLinkSignup.tsx')
    expect(invite).not.toContain("'/home'")
    expect(invite).not.toContain("'/new'")
    expect(invite).toContain('acceptInviteLink')
    expect(invite).toContain('signupWithInviteLink')
  })

  test('the token travels in the body, never in the API path', () => {
    const client = read('services/auth/inviteLinks.ts')
    expect(client).toContain("post<InviteLinkInfo>('peek', { token })")
    expect(client).not.toMatch(/invite-links\/\$\{token/)
  })

  test('the sign-in form takes the invited address from sessionStorage, not the URL', () => {
    expect(read('app/auth/login/login.tsx')).toContain('takeLoginHint()')
  })
})

describe('org picker and sidebar', () => {
  test('org cards carry one quiet line; role, plan and setup live in the menu', () => {
    const home = read('app/home/home.tsx')
    expect(home).not.toContain('OrgChips')
    expect(home).not.toContain('data-testid="org-chips"')
    expect(home).toContain('<OrgDetails org={org} info={info} />')
  })

  test('the sidebar onboarding box keeps its violet look', () => {
    const box = read('components/Dashboard/Onboarding/OnboardingSidebarBox.tsx')
    expect(box).toContain('text-violet-300')
    expect(box).toContain("t('onboarding.up_next'")
    expect(box).toContain('bg-indigo-500')
    const menu = read('components/Dashboard/Menus/DashLeftMenu.tsx')
    expect(menu).toContain('linear-gradient(90deg, #6366f1 0%, #8b5cf6 55%, #a855f7 100%)')
  })
})

describe('post-auth destination fallback', () => {
  const store = new Map()
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  }

  test('remembers a relative path for a day; peek keeps it, take uses it up', async () => {
    const { rememberPostAuthNext, peekPostAuthNext, takePostAuthNext } = await import('../lib/auth/signup.ts')
    rememberPostAuthNext('/course/abc', 1000)
    expect(peekPostAuthNext(2000)).toBe('/course/abc')
    expect(takePostAuthNext(2000)).toBe('/course/abc')
    expect(takePostAuthNext(2000)).toBeNull()
    rememberPostAuthNext('/course/abc', 0)
    expect(peekPostAuthNext(25 * 60 * 60 * 1000)).toBeNull()
  })

  test('never remembers an external destination', async () => {
    const { rememberPostAuthNext, peekPostAuthNext, isSafeNextPath } = await import('../lib/auth/signup.ts')
    for (const bad of ['//evil.test', 'https://evil.test', '/\\evil', 'course', null]) {
      rememberPostAuthNext(bad)
      expect(peekPostAuthNext()).toBeNull()
      expect(isSafeNextPath(bad)).toBe(false)
    }
    store.set('lh:post_auth_next', JSON.stringify({ next: 'https://evil.test', at: Date.now() }))
    expect(peekPostAuthNext()).toBeNull()
    store.set('lh:post_auth_next', '{oops')
    expect(peekPostAuthNext()).toBeNull()
  })

  test('signup sends next, verify and first sign-in land on it', () => {
    expect(read('app/auth/signup/OpenSignup.tsx')).toContain('rememberPostAuthNext(next)')
    const verify = read('app/auth/verify-email/verify-email.tsx')
    expect(verify).toContain('window.location.assign(next || homePath)')
    expect(read('app/auth/login/login.tsx')).toContain('peekPostAuthNext() || defaultPostAuthPath(props.org)')
  })
})
