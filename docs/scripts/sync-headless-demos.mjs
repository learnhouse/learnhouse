#!/usr/bin/env bun
// Pulls the LearnHouse Headless demo catalog into the docs: the registry from
// headless-examples/src/lib/themes.ts and its real screenshots, resized for
// the web. Run with bun (it imports the TypeScript registry directly):
//
//   bun scripts/sync-headless-demos.mjs [path/to/headless-examples]
import { writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'

const here = path.dirname(new URL(import.meta.url).pathname)
const docs = path.resolve(here, '..')
const repo = path.resolve(process.argv[2] ?? path.join(docs, '../../../../headless-examples'))
if (!existsSync(path.join(repo, 'src/lib/themes.ts'))) {
  console.error(`headless-examples not found at ${repo}`)
  process.exit(1)
}

const { THEMES, SECTIONS } = await import(path.join(repo, 'src/lib/themes.ts'))
const outImg = path.join(docs, 'public/img/headless')
await mkdir(outImg, { recursive: true })

const demos = []
for (const t of THEMES) {
  const src = path.join(repo, 'public/previews', `${t.id}.jpg`)
  if (!existsSync(src)) {
    console.warn(`no screenshot for ${t.id}, skipped`)
    continue
  }
  // 960px wide is enough for a card at 2x; macOS sips keeps it dependency-free.
  execFileSync('sips', ['-Z', '960', '-s', 'format', 'jpeg', '-s', 'formatOptions', '72', src, '--out', path.join(outImg, `${t.id}.jpg`)], { stdio: 'ignore' })
  demos.push({
    id: t.id,
    name: t.name,
    section: t.section,
    kind: t.kind,
    blurb: t.blurb,
    features: t.features,
    icon: t.icon,
  })
}

await writeFile(
  path.join(docs, 'components/headless/demos.json'),
  JSON.stringify({ sections: SECTIONS, demos }, null, 2) + '\n',
)
console.log(`${demos.length} demos, ${SECTIONS.length} sections`)
