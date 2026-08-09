#!/usr/bin/env bun
/**
 * Rewrite physical-direction Tailwind utilities to their logical equivalents,
 * so the UI mirrors correctly under `dir="rtl"` without any per-locale CSS.
 *
 *   ml-2 -> ms-2      left-0 -> start-0      text-left -> text-start
 *   mr-4 -> me-4      -right-2 -> -end-2     border-l -> border-s
 *   pl-3 -> ps-3      rounded-tl-lg -> rounded-ss-lg
 *
 * Usage:
 *   bun scripts/codemod-logical.mjs                      # dry run, whole app
 *   bun scripts/codemod-logical.mjs --write              # apply
 *   bun scripts/codemod-logical.mjs --include 'components/ui/**' --write
 *
 * Why the TypeScript compiler API and not a regex over the raw file: `pr-`,
 * `mr-` and `pl-` appear in URLs, i18n keys, and identifiers. Rewriting those
 * silently corrupts strings that have nothing to do with styling. So we only
 * ever touch string literals we can positively identify as class lists.
 */

import ts from 'typescript'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

// ── Mapping ────────────────────────────────────────────────────────────────
//
// Every entry verified to compile against tailwindcss@4.2.1.
//
// NOT converted, deliberately:
//   space-x-*, divide-x*  — already emit margin-inline-* / border-inline-* in v4
//   inset-x-*             — already emits inset-inline (symmetric)
//   translate-x-*         — physical, but a rename is wrong; needs rtl: pairs
//                           or a direction multiplier. Handled by hand.

/** Ordered: longer prefixes first, so `rounded-tl-` wins over `rounded-t`. */
const PREFIX_MAP = [
  ['rounded-tl-', 'rounded-ss-'],
  ['rounded-tr-', 'rounded-se-'],
  ['rounded-br-', 'rounded-ee-'],
  ['rounded-bl-', 'rounded-es-'],
  ['rounded-l-', 'rounded-s-'],
  ['rounded-r-', 'rounded-e-'],
  ['scroll-ml-', 'scroll-ms-'],
  ['scroll-mr-', 'scroll-me-'],
  ['scroll-pl-', 'scroll-ps-'],
  ['scroll-pr-', 'scroll-pe-'],
  ['border-l-', 'border-s-'],
  ['border-r-', 'border-e-'],
  ['left-', 'start-'],
  ['right-', 'end-'],
  ['ml-', 'ms-'],
  ['mr-', 'me-'],
  ['pl-', 'ps-'],
  ['pr-', 'pe-'],
]

/** Bare utilities with no trailing value. */
const EXACT_MAP = new Map([
  ['text-left', 'text-start'],
  ['text-right', 'text-end'],
  ['border-l', 'border-s'],
  ['border-r', 'border-e'],
  ['rounded-l', 'rounded-s'],
  ['rounded-r', 'rounded-e'],
  ['float-left', 'float-start'],
  ['float-right', 'float-end'],
])

/**
 * ⚠ THE CENTERING TRAP
 *
 * `left-1/2` paired with a -50% translate is a centering idiom: the inset and
 * the transform cancel out, and it is correct in BOTH directions — but only
 * while it stays physical. Convert `left-1/2` to `start-1/2` and in RTL the
 * inset measures from the right edge while the transform still shifts left, so
 * the element lands off-centre. No lint error, no build error, no test failure.
 *
 * The pairing is NOT always visible from the class string. components/ui/
 * dialog.tsx centers with an inline `style={{ translate: '-50% -50%' }}`, and
 * others use `translate-x-[-50%]`. Matching the transform is a losing game.
 *
 * So the rule is blunt and safe: a 50% inset is never converted. An inset of
 * exactly half is a centering idiom in practice, leaving it physical is
 * correct wherever it's paired with a translate, and it is never worse than
 * today's behaviour. The eslint rule allowlists the same shape.
 */
const CENTERING_INSET = /^-?(left|right)-(1\/2|\[50%\])$/

/**
 * Paths that are LTR by design. Flipping these produces worse output than
 * leaving them physical — see the DENY list rationale in each comment.
 */
const DENY = [
  // CodeMirror computes gutter/cursor/selection geometry from physical
  // left/right and ships its own .cm-* stylesheet. Code is LTR by language
  // spec anyway — same choice VS Code and GitHub make.
  'components/Objects/Editor/Extensions/CodePlayground/',
  // video.js vjs-* CSS is physical throughout. A half-flipped player fills the
  // progress bar one way and the buffered overlay the other.
  'components/Objects/Activities/Video/',
  // recharts emits absolute SVG x-coordinates; dir=rtl flips the DOM but not
  // the geometry, detaching axis labels from their ticks.
  'components/Dashboard/Analytics/',
  // KaTeX is LTR by specification.
  'components/Objects/Editor/Extensions/MathEquation/',
  // Rasterised to PDF by html2canvas, which handles logical properties worst
  // of all. Locked dir="ltr" instead; see certificate hardening.
  'components/Dashboard/Pages/Course/EditCourseCertification/CertificatePreview.tsx',
]

// ── Token rewriting ────────────────────────────────────────────────────────

/** Strip `md:`, `hover:`, `data-[state=open]:`, `group-hover:` … chains. */
function splitVariants(token) {
  let rest = token
  let variants = ''
  for (;;) {
    // A variant is everything up to the first `:` that isn't inside brackets.
    let depth = 0
    let cut = -1
    for (let i = 0; i < rest.length; i++) {
      const c = rest[i]
      if (c === '[') depth++
      else if (c === ']') depth--
      else if (c === ':' && depth === 0) { cut = i; break }
    }
    if (cut === -1) break
    variants += rest.slice(0, cut + 1)
    rest = rest.slice(cut + 1)
  }
  return [variants, rest]
}

function rewriteToken(token) {
  const [variants, afterVariants] = splitVariants(token)

  // `!` important prefix, then an optional negative sign.
  const bang = afterVariants.startsWith('!') ? '!' : ''
  let base = afterVariants.slice(bang.length)
  const neg = base.startsWith('-') ? '-' : ''
  base = base.slice(neg.length)

  if (CENTERING_INSET.test(neg + base)) return null

  const exact = EXACT_MAP.get(base)
  if (exact) return variants + bang + neg + exact

  for (const [from, to] of PREFIX_MAP) {
    if (base.startsWith(from)) {
      return variants + bang + neg + to + base.slice(from.length)
    }
  }
  return null
}

function rewriteClassString(value) {
  let changed = false
  let skippedCentering = false

  // Preserve original whitespace exactly — these strings are often multi-line
  // and hand-formatted, and a reformat would bury the real diff.
  const out = value.replace(/\S+/g, (token) => {
    const next = rewriteToken(token)
    if (next === null) {
      const [, base] = splitVariants(token)
      if (CENTERING_INSET.test(base.replace(/^!/, ''))) skippedCentering = true
      return token
    }
    changed = true
    return next
  })

  return { value: out, changed, skippedCentering }
}

// ── Deciding which string literals are class lists ─────────────────────────

const CLASS_ATTRS = new Set(['className', 'class', 'classNames', 'wrapperClassName'])
const CLASS_FNS = new Set(['cn', 'clsx', 'classNames', 'cva', 'twMerge', 'twJoin'])

/**
 * Cheap file-level gate: does this source mention any utility we'd convert?
 *
 * Must be LOOSER than the per-token check, not stricter — a false positive
 * only costs a parse, whereas a false negative silently skips the whole file.
 * (Splitting the raw source on whitespace does not work: the last class in an
 * attribute arrives as `text-left">`, which matches nothing.)
 */
const FILE_SCAN = new RegExp(
  '(?:^|[^\\w-])-?(?:' +
    [...EXACT_MAP.keys(), ...PREFIX_MAP.map(([from]) => from)]
      .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('|') +
    ')'
)

function fileHasTarget(source) {
  return FILE_SCAN.test(source)
}

/** Does this class string contain at least one token we'd convert? */
function hasTarget(value) {
  return value.split(/\s+/).some((t) => {
    const [, base] = splitVariants(t)
    const bare = base.replace(/^!/, '').replace(/^-/, '')
    return EXACT_MAP.has(bare) || PREFIX_MAP.some(([from]) => bare.startsWith(from))
  })
}

/**
 * Tier 2 fallback: every token looks like a Tailwind class. Catches class lists
 * extracted into a `const`, which the codebase does in several places
 * (app/global-error.tsx, services/utils/ts/colorUtils.ts).
 */
function looksLikeClassList(value) {
  if (!value.trim() || /[<>{}();=]/.test(value)) return false
  const tokens = value.trim().split(/\s+/)
  if (tokens.length === 0) return false
  return tokens.every((t) => /^[!-]?[a-z0-9][a-z0-9._/:@[\]()#%,-]*$/i.test(t))
}

/** Walk up: is this literal (transitively) a class value? */
function isClassContext(node) {
  let cur = node
  let hops = 0
  while (cur.parent && hops++ < 12) {
    const p = cur.parent

    if (ts.isJsxAttribute(p) && p.name && CLASS_ATTRS.has(p.name.getText())) return true
    if (ts.isJsxExpression(p) || ts.isParenthesizedExpression(p)) { cur = p; continue }
    if (ts.isConditionalExpression(p) || ts.isBinaryExpression(p)) { cur = p; continue }
    if (ts.isTemplateSpan(p) || ts.isTemplateExpression(p)) { cur = p; continue }
    if (ts.isArrayLiteralExpression(p)) { cur = p; continue }

    if (ts.isPropertyAssignment(p)) {
      const name = p.name?.getText?.() ?? ''
      if (CLASS_ATTRS.has(name) || /class(Name)?$/i.test(name)) return true
      cur = p
      continue
    }
    if (ts.isObjectLiteralExpression(p)) { cur = p; continue }

    if (ts.isCallExpression(p)) {
      const fn = p.expression.getText()
      return CLASS_FNS.has(fn.split('.').pop() ?? fn)
    }
    return false
  }
  return false
}

// ── Driver ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const WRITE = args.includes('--write')
const includeIdx = args.indexOf('--include')
const INCLUDE = includeIdx !== -1 ? args[includeIdx + 1] : null

const webRoot = path.resolve(import.meta.dirname, '..')

function listFiles() {
  const out = execFileSync('git', ['ls-files', '--', '*.ts', '*.tsx'], {
    cwd: webRoot,
    encoding: 'utf8',
  })
  let files = out.split('\n').filter(Boolean)
  if (INCLUDE) {
    // Simple prefix/glob match — enough for the batch slicing we do.
    const prefix = INCLUDE.replace(/\*+$/, '').replace(/\/$/, '')
    files = files.filter((f) => f.startsWith(prefix))
  }
  return files.filter((f) => !DENY.some((d) => f.startsWith(d)))
}

const report = { converted: [], skippedCentering: [], review: [] }
let filesChanged = 0

for (const rel of listFiles()) {
  const abs = path.join(webRoot, rel)
  const source = fs.readFileSync(abs, 'utf8')
  if (!fileHasTarget(source)) continue

  const sf = ts.createSourceFile(rel, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const edits = []

  const visit = (node) => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      const raw = node.text
      if (hasTarget(raw)) {
        const inClassCtx = isClassContext(node)
        if (inClassCtx || looksLikeClassList(raw)) {
          const res = rewriteClassString(raw)
          if (res.changed) {
            // Replace inside the literal's quotes, leaving delimiters intact.
            const start = node.getStart(sf)
            const end = node.getEnd()
            const text = source.slice(start, end)
            const replaced = text.replace(raw, res.value)
            if (replaced !== text) edits.push({ start, end, replaced })
            const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1
            report.converted.push(`${rel}:${line}`)
          }
          if (res.skippedCentering) {
            const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1
            report.skippedCentering.push(`${rel}:${line}`)
          }
        } else {
          const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1
          report.review.push(`${rel}:${line}  ${raw.trim().slice(0, 70)}`)
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)

  if (edits.length) {
    filesChanged++
    if (WRITE) {
      let next = source
      for (const e of edits.sort((a, b) => b.start - a.start)) {
        next = next.slice(0, e.start) + e.replaced + next.slice(e.end)
      }
      fs.writeFileSync(abs, next)
    }
  }
}

console.log(`${WRITE ? 'Rewrote' : 'Would rewrite'} ${report.converted.length} class strings in ${filesChanged} files`)

if (report.skippedCentering.length) {
  console.log(`\nSkipped ${report.skippedCentering.length} 50% insets (centering idiom — correct as physical):`)
  for (const l of report.skippedCentering) console.log(`  ${l}`)
}

if (report.review.length) {
  console.log(`\nREVIEW QUEUE — ${report.review.length} strings contain physical utilities but were not recognised as class lists:`)
  for (const l of report.review) console.log(`  ${l}`)
}

if (!WRITE) console.log('\nDry run. Pass --write to apply.')
