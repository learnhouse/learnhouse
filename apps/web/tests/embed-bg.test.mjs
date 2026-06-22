import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const script = fs.readFileSync(new URL('../public/embed-bg.js', import.meta.url), 'utf8')

function runEmbedBg({ search = '', prefersLight = false } = {}) {
  const appendedStyles = []
  const context = {
    location: {
      pathname: '/embed/demo/course/course_uuid/activity/activity_uuid',
      search,
    },
    URLSearchParams,
    document: {
      createElement(tagName) {
        assert.equal(tagName, 'style')
        return { textContent: '' }
      },
      head: {
        appendChild(style) {
          appendedStyles.push(style.textContent)
        },
      },
    },
    window: {
      matchMedia(query) {
        return { matches: query === '(prefers-color-scheme: light)' && prefersLight }
      },
    },
  }

  vm.runInNewContext(script, context)
  return appendedStyles
}

test('uses light default background when OS prefers light mode', () => {
  assert.deepEqual(runEmbedBg({ prefersLight: true }), [
    'html,body{background-color:#ffffff!important}',
  ])
})

test('keeps valid bgcolor query override above OS preference', () => {
  assert.deepEqual(runEmbedBg({ search: '?bgcolor=ff00aa', prefersLight: true }), [
    'html,body{background-color:#ff00aa!important}',
  ])
})
