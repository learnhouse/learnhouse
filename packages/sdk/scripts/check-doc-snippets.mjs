#!/usr/bin/env node
// Type-checks the TypeScript code samples in the developer docs and package
// READMEs against the real types of @learnhouse/sdk and @learnhouse/react.
//
//   node scripts/check-doc-snippets.mjs        exit 1 and print each error at its doc line
//
// Every ```ts / ```tsx block is compiled as its own module. Fence flags:
//   ```ts fragment   the body runs inside an async function (for samples that
//                    `return` from a handler); imports are hoisted out
//   ```ts signature  method signatures (`name(a: T): R`), checked as the
//                    members of an interface; imports are hoisted out
//   ```ts filename="lib/x.ts"  written at that path, so later samples of the
//                    same page can import it ('./lib/x')
//   ```ts nocheck    skipped; only for pseudo-code
// Every type the SDK exports is in scope without an import.
// A ```tsx block that starts with `<` is JSX markup and is checked as one
// expression. Names a sample uses without declaring (`lh`, `org`, `userId`…)
// come from doc-snippets.globals.d.ts, so samples stay short; anything a
// sample declares itself shadows them.

import { createRequire } from 'node:module'
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const here = dirname(fileURLToPath(import.meta.url))
const sdkDir = resolve(here, '..')
const repoRoot = resolve(sdkDir, '..', '..')
const outDir = join(sdkDir, '.cache', 'doc-snippets')

const DOC_DIRS = ['docs/content/developers/sdk', 'docs/content/developers/react']
const DOC_FILES = [
  'docs/content/developers/react/learners.mdx',
  'docs/content/developers/api/headless-assignments.mdx',
  'packages/sdk/README.md',
  'packages/react/README.md',
]

const FENCE = /^([ \t]*)```(ts|tsx|typescript)\b([^\n]*)\n([\s\S]*?)^\1```[ \t]*$/gm

function sources() {
  const files = [...DOC_FILES]
  for (const dir of DOC_DIRS) {
    for (const name of readdirSync(join(repoRoot, dir))) if (name.endsWith('.mdx')) files.push(`${dir}/${name}`)
  }
  return files.filter((f) => existsSync(join(repoRoot, f))).sort()
}

/** Removes the common indentation of a block nested in MDX (inside <Tabs>…). */
function dedent(code, indent) {
  if (!indent) return code
  return code
    .split('\n')
    .map((line) => (line.startsWith(indent) ? line.slice(indent.length) : line))
    .join('\n')
}

export function extractSnippets() {
  const snippets = []
  for (const file of sources()) {
    const text = readFileSync(join(repoRoot, file), 'utf8')
    let m
    let n = 0
    FENCE.lastIndex = 0
    while ((m = FENCE.exec(text))) {
      const [, indent, lang, meta, body] = m
      n++
      if (/\bnocheck\b/.test(meta)) continue
      const line = text.slice(0, m.index).split('\n').length + 1 // first line of code
      snippets.push({
        file,
        n,
        line,
        lang: lang === 'tsx' ? 'tsx' : 'ts',
        fragment: /\bfragment\b/.test(meta),
        signature: /\bsignature\b/.test(meta),
        filename: /\bfilename="([^"]+\.tsx?)"/.exec(meta)?.[1] ?? null,
        code: dedent(body, indent),
      })
    }
  }
  return snippets
}

/** JSX elements only (and `//` notes between them), no statements. */
function isMarkup(code) {
  const lines = code.split('\n').filter((l) => l.trim() && !l.trim().startsWith('//'))
  return lines.length > 0 && lines[0].trimStart().startsWith('<')
}

/**
 * `type X = import('@learnhouse/sdk').X` for every type the SDK exports, so
 * samples (signatures above all) can name them without imports.
 */
function writeSdkTypeAliases() {
  const entry = join(sdkDir, 'src', 'index.ts')
  const program = ts.createProgram([entry], {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    skipLibCheck: true,
    noEmit: true,
    types: [],
    paths: {
      '@learnhouse-web/media': [join(repoRoot, 'apps/web/services/media/media.ts')],
      '@services/config/config': [join(sdkDir, 'src/media/config-shim.ts')],
    },
  })
  const checker = program.getTypeChecker()
  const moduleSymbol = checker.getSymbolAtLocation(program.getSourceFile(entry))
  const names = checker
    .getExportsOfModule(moduleSymbol)
    .filter((sym) => {
      const target = sym.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(sym) : sym
      if ((target.flags & (ts.SymbolFlags.Type | ts.SymbolFlags.Class)) === 0) return false
      // Generic types need their parameters; samples import those explicitly.
      const decl = target.declarations?.[0]
      return !(decl && 'typeParameters' in decl && decl.typeParameters?.length)
    })
    .map((sym) => sym.getName())
    .sort()
  const path = join(outDir, 'sdk-types.d.ts')
  writeFileSync(path, names.map((n) => `type ${n} = import('@learnhouse/sdk').${n}`).join('\n') + '\n')
  return path
}

export function checkDocSnippets() {
  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })
  const snippets = extractSnippets()
  const byPath = new Map()
  const roots = [join(here, 'doc-snippets.globals.d.ts'), writeSdkTypeAliases()]
  for (const s of snippets) {
    // One directory per page, so a page's samples can import each other.
    const pageDir = join(outDir, s.file.replace(/[^\w]+/g, '_'))
    const path = s.filename && !s.filename.startsWith('/') && !s.filename.includes('..')
      ? join(pageDir, s.filename)
      : join(pageDir, `block_${s.n}.${s.lang}`)
    mkdirSync(dirname(path), { recursive: true })
    // A module of its own: top-level await works and declarations stay local.
    // Wrappers keep line numbers: the code starts on line 1 or 2.
    let code = s.code
    s.offset = 0
    if (s.fragment || s.signature) {
      const lines = code.split('\n')
      const imports = lines.filter((l) => /^import\s/.test(l))
      const rest = lines.map((l) => (/^import\s/.test(l) ? '' : l))
      const open = s.signature ? 'interface __Signatures {' : 'async function __fragment() {'
      code = `${imports.join(' ')}\n${open}\n${rest.join('\n')}\n}`
      s.offset = 2
    } else if (s.lang === 'tsx' && isMarkup(code)) {
      // `// note` lines between elements become JSX comments.
      const jsx = code.replace(/^(\s*)\/\/(.*)$/gm, '$1{/*$2 */}')
      code = `const __markup = (<>\n${jsx}\n</>)`
      s.offset = 1
    }
    writeFileSync(path, `${code}\nexport {}\n`)
    byPath.set(path, s)
    roots.push(path)
  }

  // React's types live with the react package's dev dependencies.
  const requireFromReact = createRequire(join(sdkDir, '..', 'react', 'package.json'))
  const reactTypes = dirname(requireFromReact.resolve('@types/react/package.json'))
  const reactDomTypes = dirname(requireFromReact.resolve('@types/react-dom/package.json'))
  const options = {
    strict: true,
    noEmit: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.ReactJSX,
    lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
    skipLibCheck: true,
    types: [],
    allowArbitraryExtensions: true,
    paths: {
      '@learnhouse/sdk': [join(sdkDir, 'src/index.ts')],
      '@learnhouse/react': [join(sdkDir, '../react/src/public.ts')],
      '@learnhouse-web/media': [join(repoRoot, 'apps/web/services/media/media.ts')],
      '@services/config/config': [join(sdkDir, 'src/media/config-shim.ts')],
      react: [join(reactTypes, 'index.d.ts')],
      'react/jsx-runtime': [join(reactTypes, 'jsx-runtime.d.ts')],
      'react-dom': [join(reactDomTypes, 'index.d.ts')],
      'react-dom/client': [join(reactDomTypes, 'client.d.ts')],
    },
  }
  const program = ts.createProgram(roots, options)
  const errors = []
  for (const d of ts.getPreEmitDiagnostics(program)) {
    const message = ts.flattenDiagnosticMessageText(d.messageText, '\n')
    const snippet = d.file ? byPath.get(resolve(d.file.fileName)) : undefined
    if (!snippet) {
      // An error in the globals or the packages themselves.
      const where = d.file ? `${relative(repoRoot, d.file.fileName)}:${d.file.getLineAndCharacterOfPosition(d.start ?? 0).line + 1}` : ''
      errors.push(`${where} ${message}`.trim())
      continue
    }
    const { line } = d.file.getLineAndCharacterOfPosition(d.start ?? 0)
    errors.push(`${snippet.file}:${snippet.line + line - snippet.offset} (block ${snippet.n}) ${message}`)
  }
  return { snippets: snippets.length, errors }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { snippets, errors } = checkDocSnippets()
  if (errors.length) {
    for (const e of errors) console.error(e)
    console.error(`\n[doc-snippets] ${errors.length} error(s) in ${snippets} samples`)
    process.exit(1)
  }
  console.log(`[doc-snippets] ${snippets} samples type-check`)
}
