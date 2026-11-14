import { describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'

// Course editor actions that run in Atlas (EE). EE is a separate checkout
// (symlinked in development, absent in OSS CI), so the suite skips there.
const webRoot = path.resolve(import.meta.dirname, '..')
const modPath = path.join(webRoot, 'ee/components/Atlas/course/courseActions.ts')
const hasEE = fs.existsSync(modPath)
const mod = hasEE ? await import(modPath) : null
const en = JSON.parse(fs.readFileSync(path.join(webRoot, 'locales/en.json'), 'utf8'))
const lookup = (key) => key.split('.').reduce((node, part) => (node && typeof node === 'object' ? node[part] : undefined), en)

const VARS = new Set(['course', 'chapter', 'activity', 'count', 'language', 'topic', 'topicPart', 'publishPart'])

describe.skipIf(!hasEE)('course Atlas actions', () => {
  const all = hasEE ? [...mod.COURSE_ACTIONS, ...mod.ITEM_ACTIONS] : []

  test('ids are unique and every text has an English string in en.json', () => {
    const ids = all.map((a) => a.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const a of all) {
      for (const [key, fallback] of [a.label, a.hint, a.prompt]) {
        expect(lookup(key)).toBe(fallback)
      }
    }
    for (const g of mod.COURSE_GROUPS) expect(lookup(g.label[0])).toBe(g.label[1])
    expect(lookup(mod.ASK_ABOUT.label[0])).toBe(mod.ASK_ABOUT.label[1])
  })

  test('prompts only use known variables, and the ones their inputs provide', () => {
    for (const a of all) {
      const used = [...a.prompt[1].matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1])
      for (const v of used) expect(VARS.has(v)).toBe(true)
      expect(used).toContain('course')
      if (used.includes('count')) expect(a.fields).toContain('count')
      if (used.includes('language')) expect(a.fields).toContain('language')
      if (used.includes('topic') || used.includes('topicPart')) expect(a.fields).toContain('topic')
      if (a.fields?.includes('count')) expect(a.count).toBeGreaterThan(0)
      if (a.scope === 'chapter') expect(used).toContain('chapter')
      if (a.scope === 'activity') expect(used).toContain('activity')
    }
  })

  test('every editor tab with a strip has actions', () => {
    for (const tab of ['general', 'content', 'seo', 'schedule', 'access', 'certification']) {
      expect(mod.actionsForTab(tab).length).toBeGreaterThan(0)
    }
    expect(mod.actionsForTab('content').map((a) => a.id)).toContain('quiz_per_chapter')
  })

  test('row menus fit the item: page tools only on pages', () => {
    const page = mod.itemActionsFor('activity', 'TYPE_DYNAMIC').map((a) => a.id)
    expect(page).toContain('activity_generate')
    expect(page).toContain('activity_flashcards')
    expect(page).not.toContain('activity_quiz_after')
    const video = mod.itemActionsFor('activity', 'TYPE_VIDEO').map((a) => a.id)
    expect(video).toEqual(['activity_summarize', 'activity_quiz_after'])
    const chapter = mod.itemActionsFor('chapter').map((a) => a.id)
    expect(chapter.every((id) => id.startsWith('chapter_'))).toBe(true)
  })

  test('promptVars and fillPrompt build the request', () => {
    const quiz = mod.findAction('quiz_per_chapter')
    const vars = mod.promptVars({ course: 'Blocks QA', values: { count: 5 } })
    const text = mod.fillPrompt(quiz.prompt[1], vars)
    expect(text).toContain('“Blocks QA”')
    expect(text).toContain('write 5 multiple-choice questions')
    expect(text).not.toContain('{{')

    const assignment = mod.findAction('assignment')
    const topicPart = (t) => ` about “${t}”`
    const none = mod.fillPrompt(assignment.prompt[1], mod.promptVars({ course: 'C', values: { topic: '  ' }, topicPart }))
    expect(none).toContain('for the course “C”. Put it')
    const some = mod.fillPrompt(assignment.prompt[1], mod.promptVars({ course: 'C', values: { topic: 'loops' }, topicPart }))
    expect(some).toContain('for the course “C” about “loops”. Put it')

    // Translations make language versions (never copies), draft or published.
    const parts = { draft: 'DRAFTS.', publish: 'PUBLISH.' }
    for (const id of ['translate_version', 'chapter_translate_version', 'activity_translate_version']) {
      const action = mod.findAction(id)
      expect(action.fields).toEqual(['language', 'publish'])
      expect(action.prompt[1]).toContain('language version')
      expect(action.prompt[1]).not.toContain('in place')
    }
    const translate = mod.findAction('translate_version')
    const draft = mod.fillPrompt(translate.prompt[1], mod.promptVars({ course: 'C', values: { language: ' Spanish ' }, publishParts: parts }))
    expect(draft).toContain('into Spanish as a language version')
    expect(draft).toContain('translate_course')
    expect(draft.endsWith('DRAFTS.')).toBe(true)
    const published = mod.promptVars({ course: 'C', values: { language: 'fr', publish: true }, publishParts: parts })
    expect(published.publishPart).toBe('PUBLISH.')
    expect(mod.findAction('activity_translate_version').prompt[1]).toContain('translate_activity')

    const page = mod.findAction('activity_add_quiz')
    const filled = mod.fillPrompt(page.prompt[1], mod.promptVars({ course: 'C', activity: 'Intro', values: { count: 3 } }))
    expect(filled).toContain('3 multiple-choice questions at the end of the page “Intro” in “C”')
  })
})
