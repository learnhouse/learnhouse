import { test, expect } from '../../../core/fixtures'
import { ORG_SLUG } from '../../../core/instance'
import { admin, cleanup, createPage, doc, library, publicPage, publish, raw, saveDraft, site } from '../api'

/**
 * The page model and its API: templates, validation, sanitizing, publishing,
 * the public read, classic (pre-builder) configs and the tools API.
 */
test.describe.configure({ mode: 'serial' })

let token = ''
let orgId = 0

test.beforeAll(async () => {
  const a = await admin()
  token = a.token
  orgId = a.org.id
  await cleanup(token, orgId)
})

test.afterAll(async () => {
  await cleanup(token, orgId)
})

test('site overview has the home page, plan caps and no engine switch', async () => {
  const s = await site(token, orgId)
  expect(s.pages.some((p: any) => p.is_home)).toBe(true)
  expect(s).not.toHaveProperty('engine')
  expect(s.caps).toMatchObject({ custom_code_plan: 'pro', extra_pages_plan: 'standard' })
})

test('every template builds, validates and publishes', async () => {
  const lib = await library(token)
  expect(lib.templates.map((t: any) => t.id)).toContain('default')
  expect(lib.sections.length).toBeGreaterThanOrEqual(30)
  for (const tpl of lib.templates) {
    const page = await createPage(token, orgId, `tpl-${tpl.id}`, tpl.id)
    expect(page.draft.root.length, tpl.id).toBeGreaterThan(0)
    const live = await publish(token, page.page_uuid)
    expect(live.published_version).toBe(1)
    const pub = await publicPage(ORG_SLUG, page.slug)
    expect(pub.mode).toBe('published')
    expect(pub.doc.root.length).toBe(page.draft.root.length)
    // Free the slot: an org has at most 20 extra pages.
    await raw('DELETE', `/landing/pages/${page.page_uuid}`, token)
  }
})

test('every library section saves as a page', async () => {
  const lib = await library(token)
  const page = await createPage(token, orgId, 'library')
  const root = lib.sections.map((s: any, i: number) => {
    // Section ids must be unique across the page.
    const clone = JSON.parse(JSON.stringify(s.node))
    const walk = (n: any, path: string) => { n.id = `l${i}${path}`.replace(/[^a-z0-9]/gi, '').slice(0, 30); (n.children || []).forEach((c: any, j: number) => walk(c, `${path}x${j}`)) }
    walk(clone, '')
    return clone
  })
  const saved = await saveDraft(token, page.page_uuid, { schema: 'lh.page', version: 1, symbols: {}, root })
  expect(saved.draft.root.length).toBe(lib.sections.length)
})

test('invalid documents are refused with readable errors', async () => {
  const page = await createPage(token, orgId, 'invalid')
  const cases: [any, string][] = [
    [{ root: [{ id: 'x', type: 'marquee' }] }, 'marquee'],
    [doc([{ id: 'b', type: 'button', props: { href: 'javascript:alert(1)' } }]), 'href'],
    [doc([{ id: 'i', type: 'image', props: { src: 'data:text/html,x' } }]), 'src'],
    [{ theme: { colors: { primary: 'red' } }, root: [] }, 'primary'],
    [{ symbols: [], root: [] }, 'symbols'],
  ]
  for (const [bad, needle] of cases) {
    const r = await raw('PUT', `/landing/pages/${page.page_uuid}/draft`, token, { doc: bad, base_revision: null })
    expect(r.status, needle).toBe(422)
    expect(JSON.stringify(r.data)).toContain(needle)
  }
})

test('custom code is sanitized and a stale tab gets a conflict', async () => {
  const page = await createPage(token, orgId, 'sanitize')
  const html = { id: 'h', type: 'html', props: { html: '<p onclick="x()">hi</p><script>alert(1)</script>', css: '@import url(x); p{color:red;background:url(javascript:alert(1))}' } }
  const r = await raw('PUT', `/landing/pages/${page.page_uuid}/draft`, token, { doc: doc([html]), base_revision: page.draft_revision })
  if (r.status === 422) {
    // Plans without custom code refuse the element outright.
    expect(JSON.stringify(r.data)).toContain('html')
    return
  }
  expect(r.status).toBe(200)
  const saved = JSON.stringify(r.data.draft)
  expect(saved).not.toContain('<script')
  expect(saved).not.toContain('onclick')
  expect(saved).not.toContain('javascript:')
  expect(saved).not.toContain('@import')
  const stale = await raw('PUT', `/landing/pages/${page.page_uuid}/draft`, token, { doc: doc([]), base_revision: page.draft_revision })
  expect(stale.status).toBe(409)
})

test('drafts stay private until published; preview links read the draft', async () => {
  const page = await createPage(token, orgId, 'publish')
  await saveDraft(token, page.page_uuid, doc([{ id: 't', type: 'heading', props: { text: 'Draft only', level: 1 } }]))
  expect((await raw('GET', `/landing/public/${ORG_SLUG}?slug=${page.slug}`, null)).status).toBe(404)
  const preview = await publicPage(ORG_SLUG, page.slug, page.preview_token)
  expect(preview.mode).toBe('preview')
  await publish(token, page.page_uuid)
  expect((await publicPage(ORG_SLUG, page.slug)).doc.root[0].children[0].children[0].props.text).toBe('Draft only')
  expect((await raw('POST', `/landing/pages/${page.page_uuid}/unpublish`, token)).status).toBe(200)
})

test('the home page always answers and cannot be unpublished or deleted', async () => {
  const home = await publicPage(ORG_SLUG, '')
  expect(['published', 'fallback']).toContain(home.mode)
  expect(home.doc.root.length).toBeGreaterThan(0)
  const s = await site(token, orgId)
  const h = s.pages.find((p: any) => p.is_home)
  expect((await raw('POST', `/landing/pages/${h.page_uuid}/unpublish`, token)).status).toBe(400)
  expect((await raw('DELETE', `/landing/pages/${h.page_uuid}`, token)).status).toBe(400)
})

test('the removed engine and conversion routes are gone', async () => {
  expect((await raw('PUT', `/landing/org/${orgId}/engine`, token, { engine: 'legacy' })).status).toBe(404)
  expect((await raw('POST', `/landing/org/${orgId}/convert`, token, {})).status).toBe(404)
})

// A classic landing PUT publishes the org home, so it only runs on an
// instance the suite booted itself (or when explicitly allowed).
const homeWritesAllowed = !process.env.E2E_BASE_URL || process.env.E2E_LANDING_HOME_WRITES === '1'
test('classic landing configs are converted and published (old clients)', async () => {
  test.skip(!homeWritesAllowed, 'would overwrite the live home page of a reused instance')
  const shapes = [
    { enabled: true, sections: [{ type: 'hero', title: 'Hero', heading: { text: 'Classic hero', color: '#ffffff' }, subheading: { text: 'Sub', color: '#eeeeee' }, background: { type: 'gradient', colors: ['#0f3d3e', '#14746f'], direction: '135deg' }, buttons: [{ text: 'Go', link: '/courses' }] }, { type: 'faq', title: 'FAQ', items: [{ question: 'Q', answer: 'A' }] }], settings: { width: 'wide', background: { type: 'solid', color: '#fafafa' } } },
    { enabled: false, sections: [{ type: 'hero', title: 'Off' }] },
    {},
  ]
  const results = []
  for (const body of shapes) {
    const out = await req('PUT', `/orgs/${orgId}/landing`, body)
    results.push(out.page.published_doc.root.length)
  }
  expect(results[0]).toBe(2)
  expect(results[1]).toBe(2) // the default page: hero + courses
  expect(results[2]).toBe(2)
})

async function req(method: string, path: string, body: unknown) {
  const r = await raw(method, path, token, body)
  expect(r.status, JSON.stringify(r.data).slice(0, 300)).toBe(200)
  return r.data
}

test('landing tools answer API tokens (MCP and API token surface)', async () => {
  const created = await raw('POST', `/orgs/${orgId}/api-tokens`, token, {
    name: 'e2e landing tools',
    rights: tokenRights(),
  })
  test.skip(created.status === 403 || created.status === 402, 'API tokens need a higher plan on this instance')
  expect(created.status, JSON.stringify(created.data)).toBe(200)
  const apiToken = created.data.token
  try {
    const page = await createPage(token, orgId, 'tools')
    const read = await raw('POST', '/tools/get_landing_page', apiToken, { page: page.slug })
    expect(read.status).toBe(200)
    const gen = await raw('POST', '/tools/generate_landing_page', apiToken, { page: page.slug, template: 'minimal' })
    expect(gen.status).toBe(200)
    const after = await raw('GET', `/landing/pages/${page.page_uuid}`, token)
    expect(after.data.review?.by).toBe('api')
    // Publishing waits for a person.
    const pub = await raw('POST', '/tools/publish_landing_page', apiToken, { page: page.slug })
    expect(JSON.stringify(pub.data)).toMatch(/approv/i)
    for (const gone of ['set_landing_engine', 'convert_legacy_landing']) {
      expect((await raw('POST', `/tools/${gone}`, apiToken, {})).status).toBe(404)
    }
  } finally {
    await raw('DELETE', `/orgs/${orgId}/api-tokens/${created.data.token_uuid}`, token)
  }
})

/** Read-only everywhere except updating the organization (what the landing tools need). */
function tokenRights() {
  // The buckets API tokens require, plus updating the organization. (Not the
  // full role shape: that would be parsed as a role and drop token-only buckets.)
  const read = { action_create: false, action_read: true, action_update: false, action_delete: false }
  return {
    courses: { ...read, action_read_own: true, action_update_own: false, action_delete_own: false },
    activities: read, coursechapters: read, folders: read, media: read, certifications: read, usergroups: read, payments: read, search: read,
    organizations: { ...read, action_update: true },
  }
}
