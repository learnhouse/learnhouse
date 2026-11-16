import { describe, expect, test } from 'bun:test'

import {
  clampSidebarWidth,
  keyboardResize,
  parseStoredWidth,
  readSidebarPrefs,
  resolveDragWidth,
  writeSidebarPrefs,
  SIDEBAR_COLLAPSED_KEY,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_KEY_STEP,
  SIDEBAR_KEY_STEP_LARGE,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_WIDTH_KEY,
} from '../components/Dashboard/Menus/sidebarWidth.ts'

const memoryStorage = (initial = {}) => {
  const data = { ...initial }
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = String(v)
    },
  }
}

describe('clampSidebarWidth', () => {
  test('keeps widths inside the range and rounds them', () => {
    expect(clampSidebarWidth(260.4)).toBe(260)
    expect(clampSidebarWidth(10)).toBe(SIDEBAR_MIN_WIDTH)
    expect(clampSidebarWidth(9999)).toBe(SIDEBAR_MAX_WIDTH)
  })

  test('falls back to the default for nonsense', () => {
    expect(clampSidebarWidth(NaN)).toBe(SIDEBAR_DEFAULT_WIDTH)
    expect(clampSidebarWidth(Infinity)).toBe(SIDEBAR_DEFAULT_WIDTH)
  })
})

describe('parseStoredWidth', () => {
  test('reads a stored number and clamps it', () => {
    expect(parseStoredWidth('300')).toBe(300)
    expect(parseStoredWidth('5000')).toBe(SIDEBAR_MAX_WIDTH)
  })

  test('missing or garbage values give the default', () => {
    expect(parseStoredWidth(null)).toBe(SIDEBAR_DEFAULT_WIDTH)
    expect(parseStoredWidth('')).toBe(SIDEBAR_DEFAULT_WIDTH)
    expect(parseStoredWidth('wide')).toBe(SIDEBAR_DEFAULT_WIDTH)
  })
})

describe('resolveDragWidth', () => {
  test('dragging toward the content widens in LTR', () => {
    expect(resolveDragWidth(240, 40, false)).toEqual({ width: 280, collapsed: false })
  })

  test('the direction flips in RTL', () => {
    expect(resolveDragWidth(240, -40, true)).toEqual({ width: 280, collapsed: false })
    expect(resolveDragWidth(240, 40, true)).toEqual({ width: 200, collapsed: false })
  })

  test('stops at the bounds', () => {
    expect(resolveDragWidth(240, 500, false).width).toBe(SIDEBAR_MAX_WIDTH)
    expect(resolveDragWidth(240, -60, false)).toEqual({ width: SIDEBAR_MIN_WIDTH, collapsed: false })
  })

  test('dragging far enough snaps to collapsed and keeps the open width', () => {
    expect(resolveDragWidth(280, -200, false)).toEqual({ width: 280, collapsed: true })
  })

  test('dragging out of the collapsed rail opens it', () => {
    expect(resolveDragWidth(64, 120, false)).toEqual({ width: SIDEBAR_MIN_WIDTH, collapsed: false })
    expect(resolveDragWidth(64, 40, false).collapsed).toBe(true)
  })
})

describe('keyboardResize', () => {
  const open = { width: 240, collapsed: false, rtl: false }

  test('arrows step, Shift steps further', () => {
    expect(keyboardResize('ArrowRight', open)).toEqual({ width: 240 + SIDEBAR_KEY_STEP, collapsed: false })
    expect(keyboardResize('ArrowLeft', { ...open, width: 300, large: true })).toEqual({
      width: 300 - SIDEBAR_KEY_STEP_LARGE,
      collapsed: false,
    })
  })

  test('arrows flip in RTL', () => {
    expect(keyboardResize('ArrowLeft', { ...open, rtl: true })).toEqual({
      width: 240 + SIDEBAR_KEY_STEP,
      collapsed: false,
    })
  })

  test('shrinking past the minimum collapses, growing reopens', () => {
    const atMin = { ...open, width: SIDEBAR_MIN_WIDTH }
    expect(keyboardResize('ArrowLeft', atMin)).toEqual({ width: SIDEBAR_MIN_WIDTH, collapsed: true })
    expect(keyboardResize('ArrowRight', { ...atMin, collapsed: true })).toEqual({
      width: SIDEBAR_MIN_WIDTH,
      collapsed: false,
    })
    expect(keyboardResize('ArrowLeft', { ...open, collapsed: true })).toEqual({ width: 240, collapsed: true })
  })

  test('Home and Enter reset, End maximises, other keys are ignored', () => {
    const custom = { width: 320, collapsed: true, rtl: false }
    expect(keyboardResize('Home', custom)).toEqual({ width: SIDEBAR_DEFAULT_WIDTH, collapsed: false })
    expect(keyboardResize('Enter', custom)).toEqual({ width: SIDEBAR_DEFAULT_WIDTH, collapsed: false })
    expect(keyboardResize('End', open)).toEqual({ width: SIDEBAR_MAX_WIDTH, collapsed: false })
    expect(keyboardResize('a', open)).toBeNull()
  })
})

describe('persistence', () => {
  test('round-trips through storage', () => {
    const storage = memoryStorage()
    writeSidebarPrefs(storage, { width: 312, collapsed: true })
    expect(storage.data[SIDEBAR_WIDTH_KEY]).toBe('312')
    expect(storage.data[SIDEBAR_COLLAPSED_KEY]).toBe('true')
    expect(readSidebarPrefs(storage)).toEqual({ width: 312, collapsed: true })
  })

  test('honours the old collapsed key on its own', () => {
    expect(readSidebarPrefs(memoryStorage({ [SIDEBAR_COLLAPSED_KEY]: 'true' }))).toEqual({
      width: SIDEBAR_DEFAULT_WIDTH,
      collapsed: true,
    })
  })

  test('survives storage that throws or is missing', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    }
    expect(readSidebarPrefs(broken)).toEqual({ width: SIDEBAR_DEFAULT_WIDTH, collapsed: false })
    expect(() => writeSidebarPrefs(broken, { width: 300, collapsed: false })).not.toThrow()
    expect(readSidebarPrefs(null)).toEqual({ width: SIDEBAR_DEFAULT_WIDTH, collapsed: false })
  })
})
