import { describe, expect, test } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const {
  AVATAR_TINTS,
  activeAuthors,
  authorInitials,
  authorName,
  authorsLineSegments,
  avatarTint,
} = await import('../components/Objects/Courses/authorsLineText.ts')

const user = (uuid, first = '', last = '', username = uuid) => ({ user_uuid: uuid, first_name: first, last_name: last, username })
const author = (u, authorship = 'CONTRIBUTOR', authorship_status = 'ACTIVE') => ({ user: u, authorship, authorship_status })

const SLOT = '\u0000names\u0000'
const sentence = (names, locale = 'en', template = `By ${SLOT}`) =>
  authorsLineSegments(names, { template, slot: SLOT, locale })
    .map((s) => (s.type === 'others' ? `[${s.count} others]` : s.value))
    .join('')

describe('activeAuthors', () => {
  test('keeps active authors with a user, once each, creators first', () => {
    const a = user('a'), b = user('b'), c = user('c'), d = user('d')
    const out = activeAuthors([
      author(a, 'CONTRIBUTOR'),
      author(b, 'CREATOR'),
      author(c, 'CONTRIBUTOR', 'PENDING'),
      author(d, 'MAINTAINER', 'INACTIVE'),
      author(a, 'CONTRIBUTOR'),
      { authorship: 'CREATOR', authorship_status: 'ACTIVE', user: null },
    ])
    expect(out.map((x) => x.user.user_uuid)).toEqual(['b', 'a'])
  })

  test('same role keeps API order; unknown roles go last', () => {
    const out = activeAuthors([
      author(user('x'), 'WHATEVER'),
      author(user('m2'), 'MAINTAINER'),
      author(user('c1'), 'CONTRIBUTOR'),
      author(user('m1'), 'MAINTAINER'),
    ])
    expect(out.map((x) => x.user.user_uuid)).toEqual(['m2', 'm1', 'c1', 'x'])
  })

  test('tolerates null and undefined', () => {
    expect(activeAuthors(null)).toEqual([])
    expect(activeAuthors(undefined)).toEqual([])
  })
})

describe('authorName', () => {
  test('full name, else either half, else @username', () => {
    expect(authorName(user('1', 'Victoria', 'Adelmant'))).toBe('Victoria Adelmant')
    expect(authorName(user('2', 'Centre for Data futures', ''))).toBe('Centre for Data futures')
    expect(authorName(user('3', '', 'Solo'))).toBe('Solo')
    expect(authorName(user('4', '  ', null, 'jdoe'))).toBe('@jdoe')
    expect(authorName({ user_uuid: '5' })).toBe('')
    expect(authorName(null)).toBe('')
  })
})

describe('authorInitials', () => {
  test('first and last word, upper-cased', () => {
    expect(authorInitials(user('1', 'Victoria', 'Adelmant'))).toBe('VA')
    expect(authorInitials(user('2', 'Centre for Data futures', ''))).toBe('CF')
    expect(authorInitials(user('3', 'élodie', ''))).toBe('É')
    expect(authorInitials(user('4', '', '', 'jdoe'))).toBe('J')
    expect(authorInitials(user('5', 'محمد', 'علي'))).toBe('مع')
    expect(authorInitials({ user_uuid: '6' })).toBe('?')
  })
})

describe('avatarTint', () => {
  test('stable per seed and always from the palette', () => {
    expect(avatarTint('user_abc')).toBe(avatarTint('user_abc'))
    for (const seed of ['a', 'b', 'user_1', 42, '', null]) expect(AVATAR_TINTS).toContain(avatarTint(seed))
    const spread = new Set(Array.from({ length: 40 }, (_, i) => avatarTint(`user_${i}`)))
    expect(spread.size).toBeGreaterThan(3)
  })

  test('no violet (reserved for AI)', () => {
    expect(AVATAR_TINTS.join(' ')).not.toContain('violet')
  })
})

describe('authorsLineSegments', () => {
  test('one, two and three authors are all named', () => {
    expect(sentence(['Ada'])).toBe('By Ada')
    expect(sentence(['Ada', 'Bo'])).toBe('By Ada and Bo')
    expect(sentence(['Ada', 'Bo', 'Cy'])).toBe('By Ada, Bo, and Cy')
  })

  test('four or more: two names, then a single "others" segment', () => {
    expect(sentence(['Ada', 'Bo', 'Cy', 'Di'])).toBe('By Ada, Bo, and [2 others]')
    const segs = authorsLineSegments(['A', 'B', 'C', 'D', 'E', 'F'], { template: SLOT, slot: SLOT, locale: 'en' })
    expect(segs.filter((s) => s.type === 'others')).toEqual([{ type: 'others', count: 4 }])
    expect(segs.filter((s) => s.type === 'name').map((s) => [s.value, s.index])).toEqual([['A', 0], ['B', 1]])
  })

  test('conjunctions follow the locale', () => {
    expect(sentence(['Ana', 'Beto'], 'es', `Por ${SLOT}`)).toBe('Por Ana y Beto')
    expect(sentence(['A', 'B'], 'fr', `Par ${SLOT}`)).toBe('Par A et B')
    expect(sentence(['A', 'B', 'C', 'D'], 'en-GB')).toBe('By A, B and [2 others]')
  })

  test('the slot can sit anywhere in the template', () => {
    expect(sentence(['A'], 'hi', `${SLOT} द्वारा`)).toBe('A द्वारा')
  })

  test('bad locale falls back instead of throwing; empty names give nothing', () => {
    expect(() => sentence(['A', 'B'], 'not a locale!!')).not.toThrow()
    expect(authorsLineSegments(['', ''], { template: SLOT, slot: SLOT })).toEqual([])
  })
})

describe('locales', () => {
  const dir = join(import.meta.dir, '..', 'locales')
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'))

  test('every locale has the authors line keys, with the plural forms it uses', () => {
    expect(files.length).toBe(22)
    for (const f of files) {
      const c = JSON.parse(readFileSync(join(dir, f), 'utf8')).courses
      const forms = Object.keys(c).filter((k) => k.startsWith('course_count_')).map((k) => k.slice('course_count_'.length))
      expect(c.by_authors, f).toContain('{{names}}')
      expect(c.created_short, f).toContain('{{date}}')
      expect(c.updated_short, f).toContain('{{when}}')
      expect(typeof c.show_all_authors, f).toBe('string')
      expect(Object.keys(c.author_role).sort(), f).toEqual(['contributor', 'creator', 'maintainer', 'reporter'])
      for (const form of forms) {
        expect(c[`others_count_${form}`], `${f} others_count_${form}`).toBeString()
        expect(c[`authors_count_${form}`], `${f} authors_count_${form}`).toBeString()
      }
      for (const old of ['co_created_by', 'created_on', 'last_updated', 'and_x_more']) expect(c[old], f).toBeUndefined()
    }
  })
})
