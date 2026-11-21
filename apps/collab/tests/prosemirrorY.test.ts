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
    {
      // Editor Plus table options: typed cells keep their value in their text.
      type: 'table',
      attrs: { variant: 'striped', caption: 'Progress', headerColumn: false, stickyHeader: true, sortable: true, compact: false, totals: 'average' },
      content: [
        {
          type: 'tableRow',
          content: [
            { type: 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: null, cellType: 'checkbox', background: 'blue', align: 'center', valign: 'middle', tone: null, numberFormat: null, currency: null }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'yes' }] }] },
            { type: 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: null, cellType: 'progress', tone: 'teal' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '75' }] }] },
            { type: 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: null, cellType: 'number', numberFormat: 'currency', currency: 'EUR' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '12.5' }] }] },
          ],
        },
      ],
    },
    // Editor Plus layout blocks: containers of ordinary blocks, the toc atom, the checklist.
    {
      type: 'tabs',
      attrs: { blockId: 'tabs_1', variant: 'pills' },
      content: [
        { type: 'tabItem', attrs: { title: 'Overview', icon: null }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Big picture' }] }] },
        {
          type: 'tabItem',
          attrs: { title: '', icon: null },
          content: [
            {
              type: 'columns',
              attrs: { layout: '1-2', gap: 'lg', stackOnMobile: false, verticalAlign: 'center' },
              content: [{ type: 'column', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }] }] }, { type: 'column', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'b' }] }] }],
            },
          ],
        },
      ],
    },
    { type: 'accordion', attrs: { single: true, variant: 'bordered' }, content: [{ type: 'toggleBlock', attrs: { summary: 'Why?', defaultOpen: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Because' }] }] }] },
    {
      type: 'timeline',
      attrs: { variant: 'process', numbered: true, orientation: 'horizontal' },
      content: [{ type: 'timelineItem', attrs: { title: 'Plan', label: 'Week 1', icon: 'flag', tone: 'blue' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Plan it' }] }] }],
    },
    { type: 'tableOfContents', attrs: { title: 'On this page', maxLevel: 2, numbered: true } },
    { type: 'keyTakeaways', attrs: { title: '', tone: 'teal', icon: 'star' }, content: [{ type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }] }] }] },
    {
      type: 'taskList',
      attrs: { blockId: 'check_1', learnerCanCheck: false },
      content: [{ type: 'taskItem', attrs: { checked: true }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'done' }] }] }, { type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'todo' }] }] }],
    },
    // Editor Plus media and data blocks: atoms with JSON attrs, and the quote with paragraphs inside.
    {
      type: 'gallery',
      attrs: {
        blockId: 'gal_1',
        layout: 'carousel',
        columns: 2,
        images: [
          { id: 'img_1', url: 'https://images.example.com/a.jpg', caption: 'Dawn', alt: 'A coast' },
          { id: 'img_2', blockObject: { block_uuid: 'block_g2', block_type: 'BLOCK_IMAGE', content: { file_id: 'f2', file_format: 'png' } }, alt: 'Tide pool' },
        ],
      },
    },
    { type: 'imageCompare', attrs: { before: { url: 'https://images.example.com/b.jpg', label: '1990' }, after: { url: 'https://images.example.com/c.jpg', label: '2020', alt: 'Forest' }, start: 35, orientation: 'vertical' } },
    {
      type: 'chart',
      attrs: { type: 'donut', title: 'Time', data: { labels: ['Read', 'Practice'], series: [{ name: 'Minutes', values: [30, 50], tone: null }] }, showLegend: true, showValues: false, stacked: false },
    },
    { type: 'statHighlights', attrs: { items: [{ id: 's1', value: '92', label: 'Completion', suffix: '%', tone: 'teal' }], columns: 3, animate: true } },
    { type: 'fileCard', attrs: { blockObject: null, url: 'https://files.example.com/list.xlsx', name: 'List', description: null, sizeBytes: null, fileType: 'sheet' } },
    { type: 'quoteBlock', attrs: { variant: 'pull', author: 'Sam', role: null, avatarUrl: null }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'It clicked.' }] }] },
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
    // Editor Plus block upgrades: the button group (buttons with style and size), inline math,
    // text alignment, and the new attrs of existing blocks.
    {
      type: 'buttonGroup',
      attrs: { alignment: 'center' },
      content: [
        { type: 'button', attrs: { emoji: '🚀', link: 'https://example.com', color: 'teal', alignment: 'left', variant: null, size: null }, content: [{ type: 'text', text: 'Start' }] },
        { type: 'button', attrs: { emoji: '📘', link: '', color: 'blue', alignment: 'left', variant: 'outline', size: 'lg' }, content: [{ type: 'text', text: 'Docs' }] },
      ],
    },
    {
      type: 'paragraph',
      attrs: { textAlign: 'center' },
      content: [{ type: 'text', text: 'Area ' }, { type: 'inlineMath', attrs: { latex: '\\pi r^2' } }, { type: 'text', text: ' units' }],
    },
    { type: 'codeBlock', attrs: { language: 'js', filename: null, showLineNumbers: true, highlightLines: '1,3-4', wrap: true }, content: [{ type: 'text', text: 'a\nb\nc\nd' }] },
    { type: 'callout', attrs: { type: 'info', dismissible: false, icon: null, title: 'Heads up', collapsible: true, defaultOpen: false, tone: 'purple', kind: 'note' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Note' }] }] },
    { type: 'toggleBlock', attrs: { summary: 'More', defaultOpen: false, variant: 'bordered', icon: 'plus' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hidden' }] }] },
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
    // Experiences family (one of each, spec schemas).
    { type: 'expSort', attrs: { blockId: 'b-sort', title: 'Sort', instructions: 'Group them', categories: [{ id: 'c1', label: 'A', color: 'green' }, { id: 'c2', label: 'B', color: 'orange' }], items: [{ id: 'i1', text: 'x', categoryId: 'c1' }, { id: 'i2', text: 'y', categoryId: 'c2', explanation: 'why' }], shuffle: true } },
    { type: 'expSequence', attrs: { blockId: 'b-seq', title: 'Order', instructions: '', items: [{ id: 'i1', text: 'one' }, { id: 'i2', text: 'two', detail: '1900' }, { id: 'i3', text: 'three' }], variant: 'timeline' } },
    { type: 'expMatch', attrs: { blockId: 'b-match', title: 'Match', instructions: '', pairs: [{ id: 'p1', left: 'L1', right: 'R1' }, { id: 'p2', left: 'L2', right: 'R2' }], mode: 'memory' } },
    { type: 'expHotspot', attrs: { blockId: 'b-hot', title: 'Find', instructions: '', imageUrl: 'https://example.com/a.png', spots: [{ id: 's1', x: 40, y: 30, r: 8, label: 'Here', explanation: 'Because', correct: true }], mode: 'find' } },
    { type: 'expGaps', attrs: { blockId: 'b-gaps', title: 'Gaps', text: 'The [[sky|heavens]] is blue.', mode: 'bank', caseSensitive: false } },
    { type: 'expMythFact', attrs: { blockId: 'b-myth', title: 'Myth', statements: [{ id: 's1', text: 'Bats are blind', isTrue: false, explanation: 'They see' }, { id: 's2', text: 'Water is wet', isTrue: true, explanation: 'Yes' }], labels: { true: 'Fact', false: 'Myth' } } },
    { type: 'expSpeedRound', attrs: { blockId: 'b-speed', title: 'Speed', questions: [{ id: 'q1', prompt: '2+2', options: ['3', '4'], answer: 1 }], secondsPerQuestion: 10, lives: 3 } },
    { type: 'expEstimate', attrs: { blockId: 'b-est', question: 'How many?', min: 0, max: 100, step: 1, answer: 42, unit: 'things', tolerancePct: 10, explanation: 'Because' } },
    { type: 'expSpotMistake', attrs: { blockId: 'b-spot', title: 'Spot', instructions: '', segments: [{ id: 's1', text: 'Fine.', isMistake: false }, { id: 's2', text: 'Wrong.', isMistake: true, correction: 'Right.', explanation: 'Why' }], kind: 'code' } },
    { type: 'expCodeLock', attrs: { blockId: 'b-lock', title: 'Lock', story: 'Locked', clues: [{ id: 'c1', question: '1+1?', answer: '2', hint: 'Count' }], reward: 'Open!' } },
    {type:  'expVenn', attrs:  {blockId:  'b-venn', title:  'Venn', instructions:  'Compare', sets:  {a:  {label:  'Cats', color:  'sky'}, b:  {label:  'Dogs', color:  'amber'}}, items:  [{id:  'i1', text:  'Purrs', zone:  'a'}, {id:  'i2', text:  'Fur', zone:  'both', explanation:  'Both'}, {id:  'i3', text:  'Barks', zone:  'b'}, {id:  'i4', text:  'Feathers', zone:  'neither'}], showNeither:  true}},
    {type:  'expLabel', attrs:  {blockId:  'b-label', title:  'Label', instructions:  'Name the parts', imageUrl:  'https://example.com/plant.png', imageObject:  null, pins:  [{id:  'p1', x:  50, y:  20, label:  'Flower'}, {id:  'p2', x:  40, y:  80, label:  'Roots'}], distractors:  ['Wing']}},
    {type:  'expWordGuess', attrs:  {blockId:  'b-word', title:  'Words', words:  [{id:  'w1', answer:  'atom', clue:  'Smallest unit', explanation:  'Why'}, {id:  'w2', answer:  'red-shift', clue:  'Light stretched'}], maxGuesses:  6}},
    {type:  'expConfidence', attrs:  {blockId:  'b-conf', title:  'Sure?', questions:  [{id:  'q1', prompt:  '2+2', options:  ['3', '4'], answer:  1, explanation:  'Count'}]}},
    {type:  'expMatrix', attrs:  {blockId:  'b-matrix', title:  'Grid', instructions:  'Tick', rows:  [{id:  'r1', label:  'Bat'}, {id:  'r2', label:  'Hen'}], columns:  [{id:  'c1', label:  'Flies'}, {id:  'c2', label:  'Lays eggs'}], cells:  {'r1:c1': true, 'r2:c2': true}, mode:  'multi'}},
    {type:  'expReflect', attrs:  {blockId:  'b-reflect', title:  'Reflect', prompt:  'What did you learn?', guidingQuestions:  ['Why?'], minWords:  30, modelAnswer:  'A model answer.', checklist:  ['Point one', 'Point two']}},
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
