// Every TypeScript sample in the developer docs (SDK and React pages) and the
// package READMEs compiles against the real types. See
// scripts/check-doc-snippets.mjs for the fence flags (fragment, signature,
// filename, nocheck) and doc-snippets.globals.d.ts for the names samples may
// use without declaring.
import { describe, expect, it } from 'vitest'

type Checker = {
  checkDocSnippets(): { snippets: number; errors: string[] }
  extractSnippets(): Array<{ file: string }>
}
const checker = (await import('../scripts/check-doc-snippets.mjs' as string)) as Checker

describe('documentation code samples', () => {
  it('finds the samples of every page', () => {
    const files = new Set(checker.extractSnippets().map((s) => s.file))
    for (const page of ['accounts', 'learning', 'community', 'admin', 'auth-modes', 'learner-app', 'server', 'embed-sessions']) {
      if (page === 'auth-modes') continue // tables only
      expect([...files], page).toContain(`docs/content/developers/sdk/${page}.mdx`)
    }
    expect([...files]).toContain('packages/sdk/README.md')
  })

  it('type-check against @learnhouse/sdk and @learnhouse/react', () => {
    const { snippets, errors } = checker.checkDocSnippets()
    expect(snippets).toBeGreaterThan(100)
    expect(errors, errors.join('\n')).toEqual([])
  }, 120_000)
})
