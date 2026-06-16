#!/usr/bin/env node
// Diff-aware strict lint gate.
//
// The previous strict gate ran ESLint over *entire* files a PR touched, so it
// failed on pre-existing debt in any file a PR happened to edit — contradicting
// its own intent ("stop new debt ... without blocking on pre-existing issues").
//
// This version lints the changed files but only *fails* on errors that land on
// lines the PR actually added/modified. Pre-existing debt on untouched lines is
// still surfaced by the report-only full-project gate, just not blocking here.
//
// Security: all dynamic values (base ref, PR-controlled file paths) are passed
// as argv via execFileSync — never interpolated into a shell string.
//
// Env:
//   LINT_DIFF_BASE   base ref to diff against (default: origin/$GITHUB_BASE_REF, else origin/dev)
// Exit: 0 = clean, 1 = new error(s) on changed lines, 2 = tooling failure.

import { execFileSync } from 'node:child_process'

const EXTS = ['ts', 'tsx', 'js', 'jsx', 'mjs']
const base =
    process.env.LINT_DIFF_BASE ||
    (process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : 'origin/dev')

const git = (args, opts = {}) =>
    execFileSync('git', args, { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, ...opts })

const root = git(['rev-parse', '--show-toplevel']).trim()
const pathspecs = EXTS.map((e) => `apps/web/**/*.${e}`)

// 1. Changed lintable files under apps/web (repo-root-relative paths).
const files = git([
    '-C', root, 'diff', '--name-only', '--diff-filter=ACMR',
    `${base}...HEAD`, '--', ...pathspecs,
]).split('\n').filter(Boolean)

if (files.length === 0) {
    console.log('No changed lintable files under apps/web.')
    process.exit(0)
}

// 2. Added/modified line numbers per file, from a zero-context diff.
const addedLines = {} // webRelPath -> Set<number>
for (const f of files) {
    const webRel = f.replace(/^apps\/web\//, '')
    const set = new Set()
    const diff = git([
        '-C', root, 'diff', '--unified=0', '--diff-filter=ACMR',
        `${base}...HEAD`, '--', f,
    ])
    let cur = 0
    for (const line of diff.split('\n')) {
        const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
        if (hunk) {
            cur = parseInt(hunk[1], 10)
            continue
        }
        if (line.startsWith('+') && !line.startsWith('+++')) {
            set.add(cur)
            cur++
        }
        // '-' lines and headers don't advance the new-file line counter.
    }
    addedLines[webRel] = set
}

// 3. Run ESLint (JSON) on the changed files; ESLint exits 1 when it reports
//    errors but still prints JSON to stdout — capture both paths.
const webFiles = files.map((f) => f.replace(/^apps\/web\//, ''))
let results
try {
    const out = execFileSync(
        'bunx',
        ['eslint', '-f', 'json', '--no-error-on-unmatched-pattern', ...webFiles],
        { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, cwd: `${root}/apps/web` },
    )
    results = JSON.parse(out)
} catch (e) {
    if (e.stdout && String(e.stdout).trim().startsWith('[')) {
        results = JSON.parse(e.stdout)
    } else {
        console.error('ESLint failed to run (exit 2 / crash):')
        console.error(e.stderr || e.message)
        process.exit(2)
    }
}

// 4. Keep only error-severity messages that fall on added/modified lines.
const offenders = []
for (const r of results) {
    const webRel = r.filePath.split('/apps/web/').pop()
    const added = addedLines[webRel]
    if (!added) continue
    for (const m of r.messages) {
        if (m.severity !== 2) continue // errors only; warnings are non-blocking
        if (added.has(m.line || 0)) {
            offenders.push(`${webRel}:${m.line}:${m.column}  ${m.ruleId || '(parse error)'}  ${m.message}`)
        }
    }
}

if (offenders.length) {
    console.error('New lint errors introduced on changed lines:\n')
    for (const o of offenders) console.error('  ' + o)
    console.error(`\n✖ ${offenders.length} new error(s) on changed lines — fix these before merging.`)
    process.exit(1)
}

console.log(`Diff-aware lint clean: no new errors on changed lines across ${files.length} file(s).`)
process.exit(0)
