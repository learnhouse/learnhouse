#!/usr/bin/env node
// Keeps package.json tied to the OSS release it is built from:
//   - "version" = apps/web/package.json "version" (also written to src/version.ts)
//   - "dependencies" = the third-party packages the bundle imports, at the
//     versions apps/web declares, plus @learnhouse/sdk at the same version
//
// Run after `node scripts/build.mjs` (it reads the build's metafile).
// `--check` changes nothing and exits 1 on any drift (used by CI and publish).
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { externalDependencies } from './build.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const pkgDir = path.resolve(here, '..')
const check = process.argv.includes('--check')

const webPkg = JSON.parse(await readFile(path.resolve(pkgDir, '../../apps/web/package.json'), 'utf8'))
const pkgPath = path.join(pkgDir, 'package.json')
const pkg = JSON.parse(await readFile(pkgPath, 'utf8'))
const metafile = JSON.parse(await readFile(path.join(pkgDir, '.cache/metafile.json'), 'utf8'))

const version = webPkg.version
const { deps, missing } = await externalDependencies(metafile)
if (missing.length) {
  console.error(`Bundle imports packages apps/web does not declare: ${missing.join(', ')}`)
  process.exit(1)
}
const dependencies = { '@learnhouse/sdk': version, ...deps }
const versionTs = `export const VERSION = '${version}'\n`
const versionPath = path.join(pkgDir, 'src/version.ts')

// Any React the web app's blocks run on; tools like `bun add` tend to pin this.
const peerDependencies = { react: '^18.2.0 || ^19.0.0', 'react-dom': '^18.2.0 || ^19.0.0' }

const problems = []
if (JSON.stringify(pkg.peerDependencies) !== JSON.stringify(peerDependencies)) problems.push('peerDependencies must stay a range')
if (pkg.version !== version) problems.push(`version ${pkg.version} != apps/web ${version}`)
if (JSON.stringify(pkg.dependencies) !== JSON.stringify(dependencies)) problems.push('dependencies differ from what the bundle imports')
if ((await readFile(versionPath, 'utf8')) !== versionTs) problems.push('src/version.ts is stale')

if (check) {
  if (problems.length) {
    console.error(`@learnhouse/react is out of sync with apps/web:\n  - ${problems.join('\n  - ')}\nRun: bun run build && bun run sync`)
    process.exit(1)
  }
  console.log(`in sync: ${version}, ${Object.keys(dependencies).length} dependencies`)
} else {
  pkg.version = version
  pkg.dependencies = dependencies
  pkg.peerDependencies = peerDependencies
  await writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)
  await writeFile(versionPath, versionTs)
  console.log(problems.length ? `updated: ${problems.join('; ')}` : 'already in sync')
}
