#!/usr/bin/env bun
/**
 * Rewrites the design-token block in styles/globals.css from design/tokens.ts.
 *
 * Usage (from apps/web):
 *   bun scripts/design-tokens.mjs           # write
 *   bun scripts/design-tokens.mjs --check   # exit 1 when the CSS is stale
 *
 * The first run inserts the block right after the shadcn @theme block.
 */
import fs from 'node:fs'
import path from 'node:path'
import { extractTokensCss, renderTokensCss } from '../design/tokensCss.ts'

const file = path.resolve(import.meta.dirname, '../styles/globals.css')
const css = fs.readFileSync(file, 'utf8')
const next = renderTokensCss()
const current = extractTokensCss(css)

if (process.argv.includes('--check')) {
  if (current === next) {
    process.stdout.write('design tokens: globals.css is up to date' + "\n")
    process.exit(0)
  }
  process.stderr.write('design tokens: globals.css is stale, run `bun scripts/design-tokens.mjs`' + "\n")
  process.exit(1)
}

let out
if (current !== null) {
  out = css.replace(current, next)
} else {
  // Insert after the first @theme { ... } block (the shadcn colors).
  const at = css.indexOf('@theme {')
  const close = at < 0 ? -1 : css.indexOf('\n}\n', at)
  if (close < 0) throw new Error('globals.css: no @theme block to insert after')
  out = `${css.slice(0, close + 3)}\n${next}\n${css.slice(close + 3)}`
}

if (out === css) {
  process.stdout.write('design tokens: no change' + "\n")
} else {
  fs.writeFileSync(file, out)
  process.stdout.write('design tokens: wrote styles/globals.css' + "\n")
}
