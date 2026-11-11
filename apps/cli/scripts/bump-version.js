#!/usr/bin/env node

/**
 * Bumps the version in both package.json and src/constants.ts
 * Usage: node scripts/bump-version.js [patch|minor|major|<version>]
 *
 * BUMP_VERSION_ROOT overrides the package root (used by tests).
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = process.env.BUMP_VERSION_ROOT
  ? path.resolve(process.env.BUMP_VERSION_ROOT)
  : path.resolve(__dirname, '..')

const pkgPath = path.join(root, 'package.json')
const constantsPath = path.join(root, 'src', 'constants.ts')

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/
const VERSION_CONST = /export const VERSION = '[^']+'/

function fail(msg) {
  console.error(msg)
  process.exit(1)
}

const bump = process.argv[2] || 'patch'

// Read current version
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
const current = SEMVER.exec(pkg.version)
if (!current) fail(`package.json version is not valid semver: ${pkg.version}`)
const [major, minor, patch] = current.slice(1, 4).map(Number)
const isPrerelease = pkg.version.includes('-')

// Like `npm version`: bumping a prerelease releases the version it leads up
// to (1.5.1-beta.1 → patch 1.5.1, 1.6.0-rc.1 → minor 1.6.0).
let newVersion
if (bump === 'patch') {
  newVersion = isPrerelease ? `${major}.${minor}.${patch}` : `${major}.${minor}.${patch + 1}`
} else if (bump === 'minor') {
  newVersion = isPrerelease && patch === 0 ? `${major}.${minor}.0` : `${major}.${minor + 1}.0`
} else if (bump === 'major') {
  newVersion = isPrerelease && minor === 0 && patch === 0 ? `${major}.0.0` : `${major + 1}.0.0`
} else if (SEMVER.test(bump)) {
  newVersion = bump
} else {
  console.error(`Invalid version bump: ${bump}`)
  fail('Usage: node scripts/bump-version.js [patch|minor|major|x.y.z[-prerelease]]')
}

// Check constants.ts before touching anything, so a changed VERSION format
// fails loudly instead of letting the two files drift
let constants = fs.readFileSync(constantsPath, 'utf-8')
if (!VERSION_CONST.test(constants)) {
  fail(`Could not find "export const VERSION = '...'" in ${constantsPath}; nothing was changed.`)
}

// Update package.json
pkg.version = newVersion
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')

// Update constants.ts
constants = constants.replace(VERSION_CONST, `export const VERSION = '${newVersion}'`)
fs.writeFileSync(constantsPath, constants)

// Confirm both files now carry the new version
const writtenPkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')).version
const writtenConst = fs.readFileSync(constantsPath, 'utf-8').includes(`export const VERSION = '${newVersion}'`)
if (writtenPkg !== newVersion || !writtenConst) {
  fail(`Version bump did not apply to both files (package.json=${writtenPkg}, constants.ts updated=${writtenConst}).`)
}

console.log(`Bumped version: ${current[0]} → ${newVersion}`)
