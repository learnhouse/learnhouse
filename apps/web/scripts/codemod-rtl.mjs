#!/usr/bin/env node
// One-shot codemod: LTR Tailwind utilities -> logical-property utilities.
// Run from apps/web: node scripts/codemod-rtl.mjs [--apply]
//
// Dry-run by default. Pass --apply to write changes.
// After applying, manually audit files with `dir="ltr"` semantics (code blocks,
// video scrubbers, charts) and restore explicit direction where needed.

import { readdir, readFile, writeFile, stat } from 'node:fs/promises'
import { join, extname } from 'node:path'

const APPLY = process.argv.includes('--apply')
const ROOT = process.cwd()
const INCLUDE = ['app', 'components', 'lib', 'styles', 'services']
const EXTS = new Set(['.tsx', '.jsx', '.ts', '.js'])
const SKIP = new Set(['node_modules', '.next', 'dist', 'build', 'out', 'scripts'])

// Delimiter chars that can PRECEDE a Tailwind token inside a class string,
// a cn()/clsx() arg, a conditional key, or a responsive-prefix boundary.
const D = `[\\s'"\`{(:]`
// Chars that can FOLLOW a bare utility (no trailing "-").
const DE = `[\\s'"\`)\\-:}]`

const RULES = [
  [new RegExp(`(${D})(-?)ml-`, 'g'),             '$1$2ms-'],
  [new RegExp(`(${D})(-?)mr-`, 'g'),             '$1$2me-'],
  [new RegExp(`(${D})pl-`, 'g'),                 '$1ps-'],
  [new RegExp(`(${D})pr-`, 'g'),                 '$1pe-'],
  [new RegExp(`(${D})(-?)left-`, 'g'),           '$1$2start-'],
  [new RegExp(`(${D})(-?)right-`, 'g'),          '$1$2end-'],
  [new RegExp(`(${D})text-left\\b`, 'g'),        '$1text-start'],
  [new RegExp(`(${D})text-right\\b`, 'g'),       '$1text-end'],
  [new RegExp(`(${D})border-l(?=${DE})`, 'g'),   '$1border-s'],
  [new RegExp(`(${D})border-r(?=${DE})`, 'g'),   '$1border-e'],
  [new RegExp(`(${D})rounded-l-`, 'g'),          '$1rounded-s-'],
  [new RegExp(`(${D})rounded-r-`, 'g'),          '$1rounded-e-'],
  [new RegExp(`(${D})rounded-tl-`, 'g'),         '$1rounded-ss-'],
  [new RegExp(`(${D})rounded-tr-`, 'g'),         '$1rounded-se-'],
  [new RegExp(`(${D})rounded-bl-`, 'g'),         '$1rounded-es-'],
  [new RegExp(`(${D})rounded-br-`, 'g'),         '$1rounded-ee-'],
  [new RegExp(`(${D})float-left\\b`, 'g'),       '$1float-start'],
  [new RegExp(`(${D})float-right\\b`, 'g'),      '$1float-end'],
]

async function* walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  for (const e of entries) {
    if (SKIP.has(e.name)) continue
    const p = join(dir, e.name)
    if (e.isDirectory()) yield* walk(p)
    else if (e.isFile() && EXTS.has(extname(e.name))) yield p
  }
}

function transform(src) {
  let out = src
  for (const [re, to] of RULES) out = out.replace(re, to)
  return out
}

let touched = 0
let checked = 0
for (const base of INCLUDE) {
  const baseDir = join(ROOT, base)
  try { await stat(baseDir) } catch { continue }
  for await (const f of walk(baseDir)) {
    checked++
    const src = await readFile(f, 'utf8')
    const next = transform(src)
    if (next !== src) {
      touched++
      if (APPLY) await writeFile(f, next, 'utf8')
      console.log(APPLY ? `[apply] ${f}` : `[dry]   ${f}`)
    }
  }
}
console.log(`\n${APPLY ? 'Applied' : 'Would modify'}: ${touched} file(s) (checked ${checked})`)
