#!/usr/bin/env node
/**
 * Generate the demo boards' canvas content.
 *
 * A board is a TipTap document synced through Yjs, so its content lives in a
 * Yjs binary state rather than in ordinary columns. The collaboration server
 * loads that state from `Board.ydoc_state` (via GET /boards/{uuid}/ydoc) the
 * first time someone opens a board, which is what makes seeding it possible at
 * all — otherwise every demo board opens on a blank canvas and reads as a
 * feature nobody uses.
 *
 * This lives in apps/collab because that is where `yjs` already is. It writes
 * binary files into the API's demo bundle, which the sync then copies into the
 * column. Same shape as scripts/build_demo_media.py: generate deterministically,
 * commit the output, keep the generator next to it.
 *
 *   cd apps/collab && bun run scripts/build_demo_boards.mjs
 *
 * Output is byte-identical across runs, so re-running produces no diff.
 */

import * as Y from 'yjs'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = join(HERE, '..', '..', 'api', 'src', 'services', 'demo', 'bundle', 'boards')

/** A paragraph of plain text, as ProseMirror stores it in Yjs. */
function paragraph(text) {
  const node = new Y.XmlElement('paragraph')
  const content = new Y.XmlText()
  if (text) content.insert(0, text)
  node.insert(0, [content])
  return node
}

/** A heading. TipTap stores `level` as a node attribute. */
function heading(text, level = 3) {
  const node = new Y.XmlElement('heading')
  node.setAttribute('level', level)
  const content = new Y.XmlText()
  content.insert(0, text)
  node.insert(0, [content])
  return node
}

function block(name, attrs, children = []) {
  const node = new Y.XmlElement(name)
  for (const [key, value] of Object.entries(attrs)) {
    node.setAttribute(key, value)
  }
  if (children.length) node.insert(0, children)
  return node
}

/** A sticky note. `content: 'block+'`, so it must hold at least one block. */
function note({ x, y, color = 'yellow', width = 260, height = 200, title, body }) {
  const children = []
  if (title) children.push(heading(title, 4))
  for (const line of [].concat(body || [])) children.push(paragraph(line))
  if (!children.length) children.push(paragraph(''))
  return block('noteBlock', { x, y, width, height, color, zIndex: 1 }, children)
}

/** A white card. Same content rule as a note. */
function card({ x, y, width = 300, height = 200, color = '#ffffff', title, body }) {
  const children = []
  if (title) children.push(heading(title, 4))
  for (const line of [].concat(body || [])) children.push(paragraph(line))
  if (!children.length) children.push(paragraph(''))
  return block('boardCard', { x, y, width, height, color, zIndex: 1 }, children)
}

/** A checklist. This one is an atom — its items live entirely in attributes. */
function todo({ x, y, width = 280, height = 260, color = 'blue', title, items }) {
  return block('todoBlock', {
    x,
    y,
    width,
    height,
    color,
    zIndex: 1,
    title,
    items: items.map((item, index) => ({
      id: `${title}-${index}`.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      text: item.text,
      done: Boolean(item.done),
    })),
  })
}

const BOARDS = {
  // Keys match the board slugs in bundle/engagement.json.
  'b-onboarding-map': [
    card({
      x: 80, y: 60, width: 380, height: 150,
      title: 'Where new starters get stuck',
      body: ['Mapped in the first retro after the spring intake. Anything here is fair game to fix.'],
    }),
    note({
      x: 80, y: 250, color: 'yellow',
      title: 'Week one',
      body: ['Nobody knows who owns which account.', 'Handbook link is three clicks deep.'],
    }),
    note({
      x: 370, y: 250, color: 'pink',
      title: 'Week two',
      body: ['Access requests sit for days.', 'Acronyms nobody explains.'],
    }),
    note({
      x: 660, y: 250, color: 'green',
      title: 'What worked',
      body: ['The running confusion list.', 'Shadowing on day two, not day five.'],
    }),
    todo({
      x: 80, y: 490, title: 'Fixes agreed',
      items: [
        { text: 'Pin the org chart in the handbook', done: true },
        { text: 'Access requests same-day', done: true },
        { text: 'Glossary of acronyms', done: false },
        { text: 'Shadowing slot booked before start date', done: false },
      ],
    }),
  ],

  'b-support-playbook': [
    card({
      x: 80, y: 60, width: 420, height: 150,
      title: 'Escalation triggers',
      body: ['Any one of these is enough. They are deliberately mechanical — no judgement call required.'],
    }),
    note({ x: 80, y: 250, color: 'pink', title: 'Two or more', body: ['Same fault reported by more than one customer within an hour. This is an incident, not a ticket.'] }),
    note({ x: 370, y: 250, color: 'pink', title: 'Legal', body: ['Legal action, a regulator or the press is mentioned. Escalate before replying.'] }),
    note({ x: 660, y: 250, color: 'orange', title: 'Money', body: ['Refund or credit above the current threshold.'] }),
    note({ x: 950, y: 250, color: 'orange', title: 'Stuck', body: ['Three days of back and forth without progress.'] }),
    card({
      x: 80, y: 500, width: 420, height: 170,
      title: 'What the customer hears',
      body: ['"I am passing this to someone who can authorise it, and you will hear back by end of day."', 'Never: "that is not my department".'],
    }),
    todo({
      x: 560, y: 500, title: 'Playbook review',
      items: [
        { text: 'Confirm the money threshold', done: true },
        { text: 'Add the incident channel name', done: false },
        { text: 'Agree who covers weekends', done: false },
      ],
    }),
  ],

  'b-q3-retro': [
    card({ x: 80, y: 60, width: 340, height: 120, title: 'Went well', body: ['Kept short on purpose. Detail lives in the notes.'] }),
    note({ x: 80, y: 210, color: 'green', body: ['Response times held through the seasonal peak.'] }),
    note({ x: 80, y: 380, color: 'green', body: ['The new starters shipped real work in week three.'] }),
    card({ x: 450, y: 60, width: 340, height: 120, title: 'Did not', body: ['No blame — these are process problems.'] }),
    note({ x: 450, y: 210, color: 'pink', body: ['A definition changed mid-quarter and nobody noticed for a month.'] }),
    note({ x: 450, y: 380, color: 'pink', body: ['Two people promised the same last unit.'] }),
    card({ x: 820, y: 60, width: 340, height: 120, title: 'Changing', body: ['Owners named, or it does not count.'] }),
    todo({
      x: 820, y: 210, height: 300, title: 'Actions',
      items: [
        { text: 'Report footers note definition changes', done: false },
        { text: 'Stock check reads committed, not on hand', done: true },
        { text: 'Retro moved to week one of the quarter', done: false },
      ],
    }),
  ],
}

mkdirSync(OUT_DIR, { recursive: true })

let total = 0
for (const [slug, nodes] of Object.entries(BOARDS)) {
  const doc = new Y.Doc()
  // TipTap's Collaboration extension stores the document in the "default"
  // XmlFragment; the board editor uses that default.
  const fragment = doc.getXmlFragment('default')
  fragment.insert(0, nodes)

  const state = Y.encodeStateAsUpdate(doc)
  const path = join(OUT_DIR, `${slug}.ydoc`)
  writeFileSync(path, Buffer.from(state))
  total += state.byteLength
  console.log(`${slug}: ${nodes.length} nodes, ${state.byteLength} bytes`)
}

console.log(`\nwrote ${Object.keys(BOARDS).length} board documents to ${OUT_DIR} (${total} bytes)`)
