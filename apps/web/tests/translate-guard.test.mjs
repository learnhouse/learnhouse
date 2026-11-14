import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// public/translate-guard.js patches Node.prototype; run it against a tiny
// stand-in DOM so the real methods are only reached for nodes still in place.
const source = readFileSync(join(import.meta.dir, '..', 'public', 'translate-guard.js'), 'utf8')

function install() {
  const calls = []
  class Node {
    constructor() {
      this.parentNode = null
    }
    removeChild(child) {
      calls.push(['remove', child])
      child.parentNode = null
      return child
    }
    insertBefore(newNode, ref) {
      calls.push(['insert', newNode, ref])
      newNode.parentNode = this
      return newNode
    }
  }
  new Function('Node', source)(Node)
  return { Node, calls }
}

describe('translate guard', () => {
  test('removes a child that is still in place', () => {
    const { Node, calls } = install()
    const parent = new Node()
    const child = new Node()
    child.parentNode = parent
    expect(parent.removeChild(child)).toBe(child)
    expect(calls).toEqual([['remove', child]])
  })

  test('leaves a child that translation already moved', () => {
    const { Node, calls } = install()
    const parent = new Node()
    const moved = new Node()
    moved.parentNode = new Node()
    expect(() => parent.removeChild(moved)).not.toThrow()
    expect(calls).toEqual([])
  })

  test('inserts before a reference that is still in place', () => {
    const { Node, calls } = install()
    const parent = new Node()
    const ref = new Node()
    ref.parentNode = parent
    const node = new Node()
    expect(parent.insertBefore(node, ref)).toBe(node)
    expect(calls).toHaveLength(1)
  })

  test('appends normally when there is no reference node', () => {
    const { Node, calls } = install()
    const parent = new Node()
    const node = new Node()
    parent.insertBefore(node, null)
    expect(calls).toHaveLength(1)
  })

  test('skips an insert whose reference translation moved', () => {
    const { Node, calls } = install()
    const parent = new Node()
    const ref = new Node()
    ref.parentNode = new Node()
    const node = new Node()
    expect(parent.insertBefore(node, ref)).toBe(node)
    expect(calls).toEqual([])
  })
})
