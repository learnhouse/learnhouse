import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import * as Y from 'yjs'
import { Schema } from 'prosemirror-model'
import { prosemirrorJSONToYXmlFragment, yXmlFragmentToProsemirrorJSON } from 'y-prosemirror'
import {
  FRAGMENT_NAME,
  OVERLAPPING_MARKS,
  type PMNode,
  canonicalize,
  emptyDoc,
  isProsemirrorDoc,
  normalizeActivityContent,
  prosemirrorJSONToYDoc,
  replaceFragmentContent,
  sameDocument,
  yDocToProsemirrorJSON,
} from '../src/prosemirrorY.ts'

const fixtures: Array<{ activity_uuid: string; name: string; content: unknown }> = JSON.parse(
  fs.readFileSync(path.join(import.meta.dirname, 'fixtures', 'activities.json'), 'utf8'),
)

// Every block the editor can hold, with the attrs its extensions declare and
// every mark, so the converter is exercised on more than the stored samples.
const EVERY_BLOCK: PMNode = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1, textAlign: null }, content: [{ type: 'text', text: 'Title' }] },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'plain ' },
        { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
        { type: 'text', text: ' italic', marks: [{ type: 'italic' }] },
        { type: 'text', text: ' both', marks: [{ type: 'bold' }, { type: 'italic' }] },
        { type: 'text', text: ' strike', marks: [{ type: 'strike' }] },
        { type: 'text', text: ' code', marks: [{ type: 'code' }] },
        { type: 'text', text: ' under', marks: [{ type: 'underline' }] },
        {
          type: 'text',
          text: ' link',
          marks: [{ type: 'link', attrs: { href: 'https://example.com', target: '_blank', rel: null, class: null } }],
        },
        { type: 'hardBreak' },
        { type: 'text', text: 'after break', marks: [{ type: 'aiStreaming' }] },
        { type: 'dynamicVariable', attrs: { key: 'first_name', fallback: 'there' } },
        { type: 'text', text: ' tag ' },
        { type: 'communityTag', attrs: { id: 'tag_1', label: 'help' } },
        { type: 'text', text: 'commented', marks: [{ type: 'comment', attrs: { threadId: 't1' } }] },
      ],
    },
    { type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Quote' }] }] },
    {
      type: 'bulletList',
      content: [
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }] },
        {
          type: 'listItem',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'two' }] },
            {
              type: 'orderedList',
              attrs: { start: 3, type: null },
              content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'nested' }] }] }],
            },
          ],
        },
      ],
    },
    { type: 'codeBlock', attrs: { language: 'python' }, content: [{ type: 'text', text: 'print("hi")\n  x = 1' }] },
    { type: 'horizontalRule' },
    { type: 'callout', attrs: { type: 'tip', dismissible: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Tip' }] }] },
    { type: 'calloutInfo', content: [{ type: 'text', text: 'legacy info' }] },
    { type: 'calloutWarning', content: [{ type: 'text', text: 'legacy warning' }] },
    {
      type: 'table',
      content: [
        {
          type: 'tableRow',
          content: [
            { type: 'tableHeader', attrs: { colspan: 1, rowspan: 1, colwidth: [120] }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'H' }] }] },
            { type: 'tableCell', attrs: { colspan: 2, rowspan: 1, colwidth: null }, content: [{ type: 'paragraph' }] },
          ],
        },
      ],
    },
    { type: 'blockImage', attrs: { blockObject: { block_uuid: 'block_1', content: { file_id: 'f', file_format: 'png' } }, size: { width: 420 }, alignment: 'center' } },
    { type: 'blockVideo', attrs: { blockObject: { block_uuid: 'block_2' }, size: 'medium' } },
    { type: 'blockAudio', attrs: { blockObject: null } },
    { type: 'blockPDF', attrs: { blockObject: { block_uuid: 'block_3' } } },
    { type: 'blockH5P', attrs: { src: 'https://h5p.example/1' } },
    { type: 'blockLibrary', attrs: { item: { id: 7, kind: 'file' } } },
    { type: 'blockMathEquation', attrs: { math_equation: 'e^{i\\pi}+1=0' } },
    {
      type: 'blockQuiz',
      attrs: {
        quizId: 'quiz_1',
        questions: [{ question_id: 'q1', question: 'Why?', type: 'multiple_choice', answers: [{ answer_id: 'a', answer: 'Because', correct: true }] }],
      },
    },
    { type: 'youtube', attrs: { src: 'https://youtu.be/x', start: 0, width: 640, height: 480 } },
    { type: 'blockEmbed', attrs: { embedUrl: 'https://example.com', embedCode: null, embedType: 'url', embedHeight: 300, embedWidth: '100%', alignment: 'left' } },
    { type: 'badge', attrs: { color: 'sky', emoji: '💡' }, content: [{ type: 'text', text: 'Badge' }] },
    { type: 'button', attrs: { emoji: '🔗', link: 'https://example.com', color: 'blue', alignment: 'left' }, content: [{ type: 'text', text: 'Go' }] },
    { type: 'blockUser', attrs: { user_id: 'user_1' } },
    { type: 'blockWebPreview', attrs: { url: 'https://example.com', title: 'Example', description: null, og_image: null, favicon: null, og_type: null, og_url: null, alignment: 'left' } },
    { type: 'flipcardGrid', attrs: { columns: 2 }, content: [{ type: 'flipcard', attrs: { question: 'Q', answer: 'A', color: 'blue', alignment: 'center', size: 'medium' } }] },
    { type: 'scenarios', attrs: { title: 'Scene', scenarios: [{ id: '1', text: 'Start', options: [] }], currentScenarioId: '1' } },
    { type: 'codePlayground', attrs: { code: 'console.log(1)', language: 'javascript' } },
    { type: 'blockMagic', attrs: { blockUuid: 'magic_1', iterations: 2, html: '<b>x</b>', sessionUuid: null } },
    {
      type: 'conditionalBlock',
      attrs: { rules: [{ kind: 'progress', op: 'gte', value: 50 }], mode: 'all' },
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Only for some' }] }],
    },
    { type: 'paragraph' },
  ],
}

/** Structural dump of a Y fragment, for comparing two encodings. */
function dump(type: Y.XmlFragment | Y.XmlElement): unknown[] {
  return type.toArray().map((child) => {
    if (child instanceof Y.XmlText) return { text: child.toDelta() }
    const el = child as Y.XmlElement
    return { name: el.nodeName, attrs: el.getAttributes(), children: dump(el) }
  })
}

/**
 * A schema that accepts the given document: every element type it uses, with
 * the attrs it uses (default null), inline when it sits among text.
 */
function schemaFor(doc: PMNode): Schema {
  const attrsOf = new Map<string, Set<string>>()
  const markAttrs = new Map<string, Set<string>>()
  const inline = new Set<string>()
  const inlineContent = new Set<string>()
  const hasChildren = new Set<string>()
  const walk = (node: PMNode) => {
    if (node.type === 'text') {
      for (const mark of node.marks ?? []) {
        const set = markAttrs.get(mark.type) ?? new Set()
        for (const k of Object.keys(mark.attrs ?? {})) set.add(k)
        markAttrs.set(mark.type, set)
      }
      return
    }
    const set = attrsOf.get(node.type) ?? new Set()
    for (const k of Object.keys(node.attrs ?? {})) set.add(k)
    attrsOf.set(node.type, set)
    const children = node.content ?? []
    if (children.length) hasChildren.add(node.type)
    if (children.some((c) => c.type === 'text')) {
      inlineContent.add(node.type)
      for (const c of children) if (c.type !== 'text') inline.add(c.type)
    }
    children.forEach(walk)
  }
  walk(doc)
  const nodes: Record<string, any> = { text: { group: 'inline' } }
  for (const [name, keys] of attrsOf) {
    const attrs = Object.fromEntries([...keys].map((k) => [k, { default: null }]))
    if (name === 'doc') {
      nodes.doc = { content: 'block+' }
    } else if (inline.has(name)) {
      nodes[name] = { group: 'inline', inline: true, attrs, content: inlineContent.has(name) ? 'inline*' : '' }
    } else {
      const content = inlineContent.has(name) ? 'inline*' : hasChildren.has(name) ? 'block*' : ''
      nodes[name] = { group: 'block', attrs, content }
    }
  }
  const marks = Object.fromEntries(
    [...markAttrs].map(([name, keys]) => [
      name,
      {
        attrs: Object.fromEntries([...keys].map((k) => [k, { default: null }])),
        // Comment threads may overlap, like the editor's comment mark
        ...(OVERLAPPING_MARKS.has(name) ? { excludes: '' } : {}),
      },
    ]),
  )
  return new Schema({ nodes, marks })
}

function roundTrip(content: unknown): PMNode {
  return yDocToProsemirrorJSON(prosemirrorJSONToYDoc(content))
}

describe('ProseMirror JSON <-> Y conversion', () => {
  it('is lossless for every stored activity fixture', () => {
    assert.ok(fixtures.length >= 10)
    for (const fixture of fixtures) {
      const normalized = normalizeActivityContent(fixture.content)
      const back = roundTrip(fixture.content)
      assert.deepEqual(canonicalize(back), canonicalize(normalized), fixture.activity_uuid)
    }
  })

  it('is lossless for a document holding every block and mark', () => {
    const normalized = normalizeActivityContent(EVERY_BLOCK)
    assert.deepEqual(canonicalize(roundTrip(EVERY_BLOCK)), canonicalize(normalized))
  })

  it('round-trips twice to the same JSON (stable)', () => {
    for (const content of [EVERY_BLOCK, ...fixtures.map((f) => f.content)]) {
      const once = roundTrip(content)
      assert.deepEqual(roundTrip(once), once)
    }
  })

  it('encodes exactly like y-prosemirror does from the editor', () => {
    for (const content of [EVERY_BLOCK, ...fixtures.map((f) => f.content)]) {
      const normalized = normalizeActivityContent(content)
      const schema = schemaFor(normalized)
      const theirs = new Y.Doc()
      prosemirrorJSONToYXmlFragment(schema, normalized, theirs.getXmlFragment(FRAGMENT_NAME))
      const ours = prosemirrorJSONToYDoc(normalized)
      // y-prosemirror fills every declared mark attr with its default (null
      // here); the stored JSON omits absent ones. Compare with nulls removed.
      const strip = (value: unknown): unknown =>
        JSON.parse(JSON.stringify(value, (_k, v) => (v === null ? undefined : v)))
      assert.deepEqual(
        strip(dump(ours.getXmlFragment(FRAGMENT_NAME))),
        strip(dump(theirs.getXmlFragment(FRAGMENT_NAME))),
      )
      // and y-prosemirror reads ours back to the same JSON
      assert.ok(sameDocument(yXmlFragmentToProsemirrorJSON(ours.getXmlFragment(FRAGMENT_NAME)) as PMNode, normalized))
    }
  })

  it('groups consecutive text into one Y.XmlText around inline nodes', () => {
    const doc = prosemirrorJSONToYDoc({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'a' },
            { type: 'text', text: 'b', marks: [{ type: 'bold' }] },
            { type: 'hardBreak' },
            { type: 'text', text: 'c' },
          ],
        },
      ],
    })
    const paragraph = doc.getXmlFragment(FRAGMENT_NAME).get(0) as Y.XmlElement
    const kinds = paragraph.toArray().map((c) => (c instanceof Y.XmlText ? 'text' : (c as Y.XmlElement).nodeName))
    assert.deepEqual(kinds, ['text', 'hardBreak', 'text'])
    assert.deepEqual((paragraph.get(0) as Y.XmlText).toDelta(), [
      { insert: 'a' },
      { insert: 'b', attributes: { bold: {} } },
    ])
  })

  it('keeps overlapping marks of the same type (several comment threads)', () => {
    const content: PMNode = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'shared',
              marks: [
                { type: 'comment', attrs: { threadId: 't1' } },
                { type: 'comment', attrs: { threadId: 't2' } },
              ],
            },
          ],
        },
      ],
    }
    const back = roundTrip(content)
    const marks = (back.content![0].content![0].marks ?? []).map((m) => m.attrs?.threadId).sort()
    assert.deepEqual(marks, ['t1', 't2'])
  })

  it('stores a single comment mark under its hashed key, as the editor does', () => {
    const doc = prosemirrorJSONToYDoc({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'comment', attrs: { threadId: 't1' } }] }] }],
    })
    const text = (doc.getXmlFragment(FRAGMENT_NAME).get(0) as Y.XmlElement).get(0) as Y.XmlText
    const keys = Object.keys(text.toDelta()[0].attributes)
    assert.equal(keys.length, 1)
    assert.match(keys[0], /^comment--[a-zA-Z0-9+/=]{8}$/)
  })

  it('drops null attrs, as y-prosemirror does', () => {
    const doc = prosemirrorJSONToYDoc({
      type: 'doc',
      content: [{ type: 'heading', attrs: { level: 2, textAlign: null }, content: [{ type: 'text', text: 'x' }] }],
    })
    const heading = doc.getXmlFragment(FRAGMENT_NAME).get(0) as Y.XmlElement
    assert.deepEqual(heading.getAttributes(), { level: 2 })
  })
})

describe('content normalization', () => {
  it('turns anything that is not a doc into an empty doc', () => {
    for (const value of [null, undefined, {}, [], 'text', { type: 'paragraph' }, { resource_uuid: 'x' }]) {
      assert.deepEqual(normalizeActivityContent(value), emptyDoc())
    }
    assert.deepEqual(normalizeActivityContent({ type: 'doc', content: [] }), emptyDoc())
    assert.equal(isProsemirrorDoc({ type: 'doc', content: 'nope' }), false)
  })

  it('renames strong/em to bold/italic', () => {
    const doc = normalizeActivityContent({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'strong' }, { type: 'em' }] }] }],
    })
    assert.deepEqual(doc.content![0].content![0].marks, [{ type: 'bold' }, { type: 'italic' }])
  })

  it('wraps legacy callout text in a paragraph and fills empty callouts', () => {
    const doc = normalizeActivityContent({
      type: 'doc',
      content: [
        { type: 'callout', attrs: { type: 'warning' }, content: [{ type: 'text', text: 'Mind ' }, { type: 'text', text: 'gap', marks: [{ type: 'bold' }] }] },
        { type: 'callout', attrs: { type: 'info' } },
        { type: 'callout', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'ok' }] }, { type: 'text', text: 'tail' }] },
      ],
    })
    assert.deepEqual(doc.content![0].content, [
      { type: 'paragraph', content: [{ type: 'text', text: 'Mind ' }, { type: 'text', text: 'gap', marks: [{ type: 'bold' }] }] },
    ])
    assert.deepEqual(doc.content![1].content, [{ type: 'paragraph' }])
    assert.deepEqual(doc.content![2].content, [
      { type: 'paragraph', content: [{ type: 'text', text: 'ok' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'tail' }] },
    ])
  })

  it('drops malformed nodes and empty text', () => {
    const doc = normalizeActivityContent({
      type: 'doc',
      content: [
        null,
        { type: '' },
        { nope: true },
        { type: 'paragraph', content: [{ type: 'text', text: '' }, { type: 'text' }, { type: 'text', text: 'kept', marks: [null, { type: 'bold', attrs: 'bad' }] }] },
      ],
    })
    assert.deepEqual(doc.content, [{ type: 'paragraph', content: [{ type: 'text', text: 'kept', marks: [{ type: 'bold' }] }] }])
  })

  it('replaces a fragment in place inside one transaction', () => {
    const doc = prosemirrorJSONToYDoc({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'old' }] }] })
    let updates = 0
    doc.on('update', () => updates++)
    doc.transact(() => {
      replaceFragmentContent(doc.getXmlFragment(FRAGMENT_NAME), {
        type: 'doc',
        content: [{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'new' }] }],
      })
    })
    assert.equal(updates, 1)
    assert.deepEqual(yDocToProsemirrorJSON(doc), {
      type: 'doc',
      content: [{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'new' }] }],
    })
  })

  it('compares documents ignoring null attrs, mark order and text splits', () => {
    const a: PMNode = {
      type: 'doc',
      content: [{ type: 'paragraph', attrs: { textAlign: null }, content: [{ type: 'text', text: 'ab', marks: [{ type: 'italic' }, { type: 'bold' }] }] }],
    }
    const b: PMNode = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'a', marks: [{ type: 'bold' }, { type: 'italic', attrs: {} }] },
            { type: 'text', text: 'b', marks: [{ type: 'bold' }, { type: 'italic' }] },
          ],
        },
      ],
    }
    assert.ok(sameDocument(a, b))
    assert.ok(!sameDocument(a, { ...b, content: [{ type: 'paragraph' }] }))
  })
})
