import { describe, expect, test } from 'bun:test'

import {
  buildSubTabSearch,
  resolveSubTab,
  SUB_TAB_PARAM,
  subTabStorageKey,
} from '../components/Dashboard/Shared/DashKit/subTabsUrl.ts'

const KEYS = ['general', 'branding', 'seo']

describe('resolveSubTab', () => {
  test('falls back to the default with nothing set', () => {
    expect(resolveSubTab({ urlValue: null, defaultKey: 'general', keys: KEYS })).toBe('general')
  })

  test('the URL wins over the remembered pick', () => {
    expect(resolveSubTab({ urlValue: 'seo', stored: 'branding', defaultKey: 'general', keys: KEYS })).toBe('seo')
  })

  test('a pending local pick beats the URL it was made on', () => {
    expect(
      resolveSubTab({ urlValue: 'seo', local: 'branding', stored: 'seo', defaultKey: 'general', keys: KEYS })
    ).toBe('branding')
  })

  test('a local pick beats the remembered one', () => {
    expect(resolveSubTab({ urlValue: null, local: 'branding', stored: 'seo', defaultKey: 'general', keys: KEYS })).toBe(
      'branding'
    )
  })

  test('the remembered sub-tab is used when the URL has none', () => {
    expect(resolveSubTab({ urlValue: null, stored: 'seo', defaultKey: 'general', keys: KEYS })).toBe('seo')
  })

  test('unknown or hidden keys are skipped', () => {
    expect(resolveSubTab({ urlValue: 'nope', stored: 'gone', defaultKey: 'general', keys: KEYS })).toBe('general')
    expect(resolveSubTab({ urlValue: 'nope', stored: 'seo', defaultKey: 'general', keys: KEYS })).toBe('seo')
  })

  test('a hidden default falls back to the first visible key', () => {
    expect(resolveSubTab({ urlValue: null, defaultKey: 'general', keys: ['branding', 'seo'] })).toBe('branding')
  })
})

describe('buildSubTabSearch', () => {
  test('sets the param for a non-default sub-tab', () => {
    expect(buildSubTabSearch('', SUB_TAB_PARAM, 'seo', 'general')).toBe('?section=seo')
  })

  test('drops the param for the default sub-tab', () => {
    expect(buildSubTabSearch('?section=seo', SUB_TAB_PARAM, 'general', 'general')).toBe('')
  })

  test('keeps other params', () => {
    expect(buildSubTabSearch('?new=1&section=seo', SUB_TAB_PARAM, 'branding', 'general')).toBe(
      '?new=1&section=branding'
    )
    expect(buildSubTabSearch('?new=1&section=seo', SUB_TAB_PARAM, 'general', 'general')).toBe('?new=1')
  })

  test('accepts a search string without the leading ?', () => {
    expect(buildSubTabSearch('a=b', 'tab', 'x', 'y')).toBe('?a=b&tab=x')
  })
})

describe('subTabStorageKey', () => {
  test('is scoped by page and param', () => {
    expect(subTabStorageKey('/dash/org/settings/general')).toBe('lh:subtab:/dash/org/settings/general:section')
    expect(subTabStorageKey('/x', 'tab')).not.toBe(subTabStorageKey('/x'))
  })
})
