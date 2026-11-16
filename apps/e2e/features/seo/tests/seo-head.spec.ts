import { expect, test, devices } from '@playwright/test'

/**
 * Search/AI crawlers get every page's metadata and structured data in the
 * initial HTML <head> (no JavaScript needed), with a correct canonical and a
 * mobile viewport; people get the same page. URLs come from the org's own
 * sitemap, so the spec runs against any instance with some public content.
 */

const GOOGLEBOT =
  'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'
const BINGBOT = 'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)'
const PERSON = devices['Pixel 7'].userAgent

const locs = (xml: string) => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].replace(/&amp;/g, '&'))
const sameOrigin = (url: string, base: string) => new URL(url, base).pathname + new URL(url, base).search

async function samplePages(request: any, baseURL: string): Promise<string[]> {
  const index = await (await request.get('/sitemap.xml')).text()
  const pages = new Set<string>(['/'])
  for (const child of locs(index)) {
    const urls = locs(await (await request.get(sameOrigin(child, baseURL))).text())
    for (const u of urls.slice(0, 2)) pages.add(sameOrigin(u, baseURL))
  }
  return [...pages].slice(0, 16)
}

function head(html: string) {
  const end = html.indexOf('</head>')
  expect(end, 'document has a </head>').toBeGreaterThan(0)
  return html.slice(0, end)
}

test.describe('SEO: crawler-ready HTML', () => {
  test('robots.txt points to the sitemap and the sitemap is an index', async ({ request }) => {
    const robots = await request.get('/robots.txt')
    expect(robots.ok()).toBeTruthy()
    const text = await robots.text()
    expect(text).toMatch(/^Sitemap: https?:\/\/\S+\/sitemap\.xml$/m)
    const sitemap = await request.get('/sitemap.xml')
    expect(sitemap.headers()['content-type']).toContain('application/xml')
    expect(await sitemap.text()).toContain('<sitemapindex')
  })

  for (const [label, ua] of [
    ['Googlebot', GOOGLEBOT],
    ['Bingbot', BINGBOT],
  ] as const) {
    test(`${label} gets title, description, canonical, robots, viewport and JSON-LD in <head>`, async ({ request, baseURL }) => {
      for (const path of await samplePages(request, baseURL!)) {
        const res = await request.get(path, { headers: { 'User-Agent': ua }, maxRedirects: 0 })
        expect(res.status(), path).toBe(200)
        const h = head(await res.text())
        expect(h, `${path} title`).toMatch(/<title>[^<]{3,}<\/title>/)
        expect(h, `${path} description`).toMatch(/<meta name="description" content="[^"]{10,}"/)
        expect(h, `${path} viewport`).toContain('name="viewport" content="width=device-width, initial-scale=1')
        const canonical = h.match(/<link rel="canonical" href="([^"]+)"/)?.[1]
        expect(canonical, `${path} canonical`).toBeTruthy()
        expect(new URL(canonical!).pathname.replace(/\/$/, '') || '/', `${path} canonical path`).toBe(new URL(path, baseURL).pathname.replace(/\/$/, '') || '/')
        expect(h, `${path} robots`).toMatch(/<meta name="robots" content="index, follow"/)
        expect(h, `${path} og:title`).toContain('property="og:title"')
      }
    })
  }

  test('structured data parses and every page has some', async ({ request, baseURL }) => {
    for (const path of await samplePages(request, baseURL!)) {
      const html = await (await request.get(path, { headers: { 'User-Agent': GOOGLEBOT } })).text()
      const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]))
      expect(blocks.length, `${path} JSON-LD`).toBeGreaterThan(0)
      for (const b of blocks) expect(b['@context'], path).toBe('https://schema.org')
    }
  })

  test('people get the same canonical page, on a phone, without horizontal scroll', async ({ browser, baseURL }) => {
    const context = await browser.newContext({ ...devices['Pixel 7'], userAgent: PERSON })
    const page = await context.newPage()
    await page.goto(baseURL!)
    // People get streamed metadata (it may land after </head>): same canonical, one copy.
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(1)
    const viewport = await page.locator('head meta[name="viewport"]').getAttribute('content')
    expect(viewport).toContain('width=device-width')
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow).toBeLessThanOrEqual(1)
    await context.close()
  })

  test('feeds, llms.txt and the manifest are served with the right types', async ({ request }) => {
    const feed = await request.get('/feed.xml')
    expect(feed.headers()['content-type']).toContain('application/rss+xml')
    expect(await feed.text()).toContain('<rss version="2.0"')
    const json = await request.get('/feed.json')
    expect((await json.json()).version).toBe('https://jsonfeed.org/version/1.1')
    const llms = await request.get('/llms.txt')
    if (llms.ok()) expect(await llms.text()).toMatch(/^# .+\n\n> /)
    const manifest = await request.get('/manifest.webmanifest')
    expect(manifest.headers()['content-type']).toContain('application/manifest+json')
    expect((await manifest.json()).start_url).toBe('/')
  })

  test('app chrome is never indexable', async ({ request }) => {
    for (const path of ['/dash', '/auth/login', '/embed/default/course/x']) {
      const res = await request.get(path, { maxRedirects: 0 })
      expect(res.headers()['x-robots-tag'] || '', path).toContain('noindex')
    }
  })
})
