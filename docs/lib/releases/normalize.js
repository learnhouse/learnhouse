import { CLI_TAG_PREFIX } from './config'
import { cleanHeading, extractHandles, inlineText, parseReleaseBody } from './markdown'

/** Sections that repeat the same install boilerplate in every release. */
const BOILERPLATE_RE = /^(getting started|install(ation)?)$/i
const MERGE_RE = /^merge (pull request|branch)\b/i

/** Map a cleaned `##` heading to a display label + a counting bucket. */
function classifySection(label) {
  if (/feature/i.test(label)) return { label: 'Features', kind: 'features' }
  if (/fix/i.test(label)) return { label: 'Fixes', kind: 'fixes' }
  return { label, kind: 'other' }
}

function isMergeItem(item) {
  return MERGE_RE.test(inlineText(item.c))
}

/** Walk every block (incl. inside quotes) of a section list. */
function* walkBlocks(blocks) {
  for (const b of blocks) {
    yield b
    if (b.type === 'quote') yield* walkBlocks(b.blocks)
  }
}

function findLabelled(sections, label) {
  for (const s of sections) {
    for (const b of walkBlocks(s.blocks)) {
      if (b.type !== 'para') continue
      const text = inlineText(b.c).trim()
      if (text.toLowerCase().startsWith(label)) return b
    }
  }
  return null
}

/**
 * Turn a GitHub release object into the shape the /releases UI renders.
 * Everything returned is JSON-serializable.
 */
export function normalizeRelease(raw) {
  const tag = raw.tag_name
  const kind = tag.startsWith(CLI_TAG_PREFIX) ? 'cli' : 'app'
  const version = (kind === 'cli' ? tag.slice(CLI_TAG_PREFIX.length) : tag).replace(/^v/, '')
  const parsed = parseReleaseBody(raw.body)

  let intro = []
  const sections = []
  const alerts = []
  let contributors = []
  let newContributors = []

  for (const section of parsed) {
    // GitHub alerts (e.g. the database-migration warning) are surfaced at the
    // top of the release no matter which section they were written in.
    const keep = []
    for (const b of section.blocks) {
      if (b.type === 'quote' && b.alert) alerts.push(b)
      else keep.push(b)
    }

    if (section.title === null) {
      intro = keep.filter((b) => b.type === 'heading' || b.type === 'para' || b.type === 'list')
      continue
    }

    const label = cleanHeading(section.title)
    if (BOILERPLATE_RE.test(label)) continue

    if (/^new contributors?$/i.test(label)) {
      const text = keep.flatMap((b) => (b.type === 'list' ? b.items.map((it) => inlineText(it.c)) : b.type === 'para' ? [inlineText(b.c)] : []))
      newContributors = extractHandles(text.join(' '))
      continue
    }
    if (/^contributors?$/i.test(label)) {
      const text = keep.map((b) => (b.type === 'para' ? inlineText(b.c) : b.type === 'list' ? b.items.map((it) => inlineText(it.c)).join(' ') : ''))
      contributors = extractHandles(text.join(' '))
      continue
    }

    if (keep.length === 0) continue
    // "Merge pull request #…" lines repeat the commits listed next to them;
    // keep them, but after the real changes.
    for (const b of keep) {
      if (b.type === 'list') b.items = [...b.items.filter((it) => !isMergeItem(it)), ...b.items.filter(isMergeItem)]
    }
    const { label: display, kind: bucket } = classifySection(label)
    const items = keep.flatMap((b) => (b.type === 'list' ? b.items : []))
    sections.push({
      label: display,
      kind: bucket,
      blocks: keep,
      itemCount: items.length,
      changeCount: items.filter((it) => !isMergeItem(it)).length,
    })
  }

  const counts = { features: 0, fixes: 0, total: 0, items: 0 }
  for (const s of sections) {
    counts.items += s.itemCount
    counts.total += s.changeCount
    if (s.kind === 'features') counts.features += s.changeCount
    if (s.kind === 'fixes') counts.fixes += s.changeCount
  }

  const changelog = findLabelled(parsed, 'full changelog')
  const compareUrl = changelog?.c.find((n) => n.t === 'link')?.href || null
  const prPara = findLabelled(parsed, 'pull request:')
  const pr = prPara?.c.find((n) => n.t === 'ref')?.n || null

  return {
    tag,
    kind,
    version,
    name: raw.name || (kind === 'cli' ? `CLI ${version}` : version),
    date: raw.published_at || raw.created_at || null,
    url: raw.html_url,
    prerelease: Boolean(raw.prerelease),
    intro,
    alerts,
    sections,
    counts,
    contributors,
    newContributors,
    compareUrl,
    pr,
  }
}

/** Strip a GitHub API release down to the fields the hub uses (for the snapshot). */
export function slimRelease(raw) {
  return {
    tag_name: raw.tag_name,
    name: raw.name,
    body: raw.body || '',
    html_url: raw.html_url,
    published_at: raw.published_at,
    created_at: raw.created_at,
    prerelease: Boolean(raw.prerelease),
    draft: Boolean(raw.draft),
  }
}

export function sortByDateDesc(a, b) {
  return new Date(b.date || 0) - new Date(a.date || 0)
}
