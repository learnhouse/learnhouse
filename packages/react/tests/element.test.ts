import { beforeAll, describe, expect, it, vi } from 'vitest'
import { waitFor } from '@testing-library/react'
import { TAG_NAME, LearnHouseActivityElement } from '../dist/element.js'
import doc from './fixtures/all-blocks.json'

const BASE = 'https://learn.example.com'

function mount(setup: (el: any) => void) {
  const el = document.createElement(TAG_NAME) as any
  setup(el)
  document.body.appendChild(el)
  return el
}

describe('<learnhouse-activity>', () => {
  beforeAll(() => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })))
  })

  it('registers itself once', () => {
    expect(customElements.get('learnhouse-activity')).toBe(LearnHouseActivityElement)
  })

  it('renders a document set as a property, inside the scoped root', async () => {
    const el = mount((el) => {
      el.content = doc
      el.orgId = 'org_test'
    })
    await waitFor(() => expect(el.querySelector('h2')?.textContent).toBe('Getting paid'), { timeout: 30000 })
    expect(el.querySelector('.lh-activity')).toBeTruthy()
    el.remove()
  }, 60000)

  it('reads attributes, including JSON theme and a comma list of hidden blocks', async () => {
    const el = mount((el) => {
      el.setAttribute('theme', JSON.stringify({ mode: 'dark', accent: '#7c3aed' }))
      el.setAttribute('hide-blocks', 'table, blockquote')
      el.setAttribute('content', JSON.stringify(doc))
      el.setAttribute('show-title', '')
    })
    await waitFor(() => expect(el.querySelector('h2')).toBeTruthy(), { timeout: 10000 })
    const root = el.querySelector('.lh-activity') as HTMLElement
    expect(root.classList.contains('dark')).toBe(true)
    expect(root.style.getPropertyValue('--lh-accent')).toBe('#7c3aed')
    expect(el.querySelector('table')).toBeNull()
    expect(el.querySelector('blockquote')).toBeNull()
    el.remove()
  })

  it('acts as the learner with a session attribute and fires lh-progress', async () => {
    const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, '')
    const token = `${b64({ alg: 'HS256' })}.${b64({ sub: 'lea@example.com', exp: Math.floor(Date.now() / 1000) + 900 })}.sig`
    const activity = {
      id: 5, activity_uuid: 'activity_el', name: 'L', activity_type: 'TYPE_DYNAMIC',
      activity_sub_type: 'SUBTYPE_DYNAMIC_PAGE', course_id: 3, org_id: 1, published: true,
      content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Element learner' }] }] },
    }
    const auths: (string | null)[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init: RequestInit = {}) => {
        auths.push(new Headers(init.headers).get('authorization'))
        const url = String(input)
        const body = url.endsWith('/activities/activity_el')
          ? activity
          : url.includes('/courses/course_el/meta')
            ? { id: 3, org_id: 1, course_uuid: 'course_el', chapters: [] }
            : url.includes('/trail/')
              ? { runs: [{ course_id: 3, steps: init.method === 'POST' ? [{ activity_id: 5 }] : [] }] }
              : url.includes('/users/session')
                ? { user: { id: 9 }, roles: [] }
                : null
        return new Response(JSON.stringify(body ?? {}), {
          status: body ? 200 : 404,
          headers: { 'content-type': 'application/json' },
        })
      }),
    )
    const progress = vi.fn()
    const el = mount((el) => {
      el.setAttribute('base-url', BASE)
      el.setAttribute('session', token)
      el.setAttribute('activity-id', 'activity_el')
      el.setAttribute('course-id', 'course_el')
      el.setAttribute('completion', 'button')
      el.addEventListener('lh-progress', (e: CustomEvent) => progress(e.detail))
    })
    const button = await waitFor(
      () => {
        const b = el.querySelector('.lh-completion-button') as HTMLButtonElement | null
        expect(b).toBeTruthy()
        return b!
      },
      { timeout: 30000 },
    )
    button.click()
    await waitFor(() => expect(progress).toHaveBeenCalledWith({ type: 'progress', activityId: 'activity_el', completed: true }))
    expect(auths.every((a) => a === `Bearer ${token}`)).toBe(true)
    el.remove()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })))
  }, 60000)

  it('picks up properties set before the element was upgraded', async () => {
    // Simulate a framework setting props on an element that is not defined yet.
    const pending = document.createElement('learnhouse-activity-later') as any
    pending.content = doc
    document.body.appendChild(pending)
    customElements.define('learnhouse-activity-later', class extends LearnHouseActivityElement {})
    await waitFor(() => expect(pending.querySelector('h2')).toBeTruthy(), { timeout: 10000 })
    expect(Object.prototype.hasOwnProperty.call(pending, 'content')).toBe(false)
    pending.remove()
  })

  it('dispatches renderer events as DOM events and lets lh-link-click cancel navigation', async () => {
    const seen: string[] = []
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    const el = mount((el) => {
      el.content = doc
      for (const type of ['lh-load', 'lh-ready', 'lh-event']) el.addEventListener(type, () => seen.push(type))
      el.addEventListener('lh-link-click', (e: CustomEvent) => {
        seen.push(`click:${e.detail.href}:${e.detail.external}`)
        e.preventDefault()
      })
    })
    await waitFor(() => expect(seen).toContain('lh-ready'), { timeout: 10000 })
    expect(seen).toContain('lh-load')
    expect(seen).toContain('lh-event')
    const link = [...el.querySelectorAll('a')].find((a: HTMLAnchorElement) => a.textContent === 'fee guide') as HTMLAnchorElement
    link.click()
    expect(seen).toContain('click:https://example.com/fees:true')
    expect(open).not.toHaveBeenCalled()
    el.remove()
  })

  it('reports errors with lh-error, and hide-error leaves the UI to the host', async () => {
    const errors: Error[] = []
    const el = mount((el) => {
      el.baseUrl = BASE
      el.activityId = 'activity_missing'
      el.hideError = true
      el.addEventListener('lh-error', (e: CustomEvent) => errors.push(e.detail.error))
    })
    await waitFor(() => expect(errors.length).toBe(1), { timeout: 10000 })
    expect(el.querySelector('[role="alert"]')).toBeNull()
    el.hideError = false
    await waitFor(() => expect(el.querySelector('[role="alert"]')).toBeTruthy())
    el.reload()
    await waitFor(() => expect(errors.length).toBe(2))
    el.remove()
  })

  it('unmounts when removed', async () => {
    const el = mount((el) => (el.content = doc))
    await waitFor(() => expect(el.querySelector('h2')).toBeTruthy(), { timeout: 10000 })
    el.remove()
    await new Promise((r) => setTimeout(r, 0))
    expect(el.childNodes.length).toBe(0)
  })
})
