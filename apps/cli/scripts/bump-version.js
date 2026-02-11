#!/usr/bin/env node

/**
 * Bumps the version in both package.json and src/constants.ts
 * Usage: node scripts/bump-version.js [patch|minor|major|<version>]
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

const pkgPath = path.join(root, 'package.json')
const constantsPath = path.join(root, 'src', 'constants.ts')

const bump = process.argv[2] || 'patch'

// Read current version
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
const [major, minor, patch] = pkg.version.split('.').map(Number)

let newVersion
if (bump === 'patch') {
  newVersion = `${major}.${minor}.${patch + 1}`
} else if (bump === 'minor') {
  newVersion = `${major}.${minor + 1}.0`
} else if (bump === 'major') {
  newVersion = `${major + 1}.0.0`
} else if (/^\d+\.\d+\.\d+/.test(bump)) {
  newVersion = bump
} else {
  console.error(`Invalid version bump: ${bump}`)
  console.error('Usage: node scripts/bump-version.js [patch|minor|major|x.y.z]')
  process.exit(1)
}

// Update package.json
pkg.version = newVersion
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')

// Update constants.ts
let constants = fs.readFileSync(constantsPath, 'utf-8')
constants = constants.replace(
  /export const VERSION = '[^']+'/,
  `export const VERSION = '${newVersion}'`,
)
fs.writeFileSync(constantsPath, constants)

console.log(`Bumped version: ${major}.${minor}.${patch} → ${newVersion}`)
