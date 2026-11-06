#!/usr/bin/env node
// Keeps package.json tied to the OSS release it ships with:
//   - "version" = apps/web/package.json "version" (also written to src/version.ts)
//   - @learnhouse/react and @learnhouse/sdk at that same version
//   - react / react-dom at the versions apps/web runs (the renderer is React)
//
// `--check` changes nothing and exits 1 on any drift (used by CI and publish).
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const pkgDir = path.resolve(here, '..')
const check = process.argv.includes('--check')

const webPkg = JSON.parse(await readFile(path.resolve(pkgDir, '../../apps/web/package.json'), 'utf8'))
const pkgPath = path.join(pkgDir, 'package.json')
const pkg = JSON.parse(await readFile(pkgPath, 'utf8'))

const version = webPkg.version
const caret = (name) => `^${webPkg.dependencies[name].replace(/^[\^~]/, '')}`
const dependencies = {
  '@learnhouse/react': version,
  '@learnhouse/sdk': version,
  react: caret('react'),
  'react-dom': caret('react-dom'),
}
const peerDependencies = { vue: '^3.3.0' }
const versionTs = `export const VERSION = '${version}'\n`
const versionPath = path.join(pkgDir, 'src/version.ts')

const problems = []
if (pkg.version !== version) problems.push(`version ${pkg.version} != apps/web ${version}`)
if (JSON.stringify(pkg.dependencies) !== JSON.stringify(dependencies)) problems.push('dependencies differ from apps/web')
if (JSON.stringify(pkg.peerDependencies) !== JSON.stringify(peerDependencies)) problems.push('peerDependencies must stay a range')
if ((await readFile(versionPath, 'utf8')) !== versionTs) problems.push('src/version.ts is stale')

if (check) {
  if (problems.length) {
    console.error(`@learnhouse/vue is out of sync with apps/web:\n  - ${problems.join('\n  - ')}\nRun: bun run sync`)
    process.exit(1)
  }
  console.log(`in sync: ${version}`)
} else {
  pkg.version = version
  pkg.dependencies = dependencies
  pkg.peerDependencies = peerDependencies
  await writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)
  await writeFile(versionPath, versionTs)
  console.log(problems.length ? `updated: ${problems.join('; ')}` : 'already in sync')
}
