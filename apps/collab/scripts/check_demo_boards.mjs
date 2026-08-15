#!/usr/bin/env node
/**
 * Verify the generated board documents decode the way the editor needs.
 *
 * The board stores card positions as node attributes and then does arithmetic
 * on them while dragging (`nodeX + dx`). If an attribute comes back as the
 * string "120" instead of the number 120, the first drag concatenates instead
 * of adding and the card jumps somewhere absurd — a failure that is invisible
 * until someone actually drags a seeded card.
 */

import * as Y from 'yjs'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const DIR = join(HERE, '..', '..', 'api', 'src', 'services', 'demo', 'bundle', 'boards')

let failures = 0

for (const file of readdirSync(DIR).filter((f) => f.endsWith('.ydoc'))) {
  const doc = new Y.Doc()
  Y.applyUpdate(doc, new Uint8Array(readFileSync(join(DIR, file))))
  const fragment = doc.getXmlFragment('default')

  const nodes = fragment.toArray()
  console.log(`\n${file}: ${nodes.length} top-level nodes`)

  for (const node of nodes) {
    const attrs = node.getAttributes()
    const name = node.nodeName
    for (const key of ['x', 'y', 'width', 'height', 'zIndex']) {
      if (!(key in attrs)) continue
      const value = attrs[key]
      if (typeof value !== 'number') {
        console.error(`  FAIL ${name}.${key} is ${typeof value} (${JSON.stringify(value)}), expected number`)
        failures += 1
      }
    }
    if (name === 'todoBlock') {
      if (!Array.isArray(attrs.items)) {
        console.error(`  FAIL todoBlock.items is ${typeof attrs.items}, expected array`)
        failures += 1
      } else {
        const bad = attrs.items.filter((i) => typeof i.done !== 'boolean')
        if (bad.length) {
          console.error(`  FAIL todoBlock has ${bad.length} item(s) whose done is not boolean`)
          failures += 1
        }
      }
    }
    const text = node.toString().replace(/<[^>]+>/g, ' ').trim()
    console.log(`  ${name.padEnd(12)} x=${attrs.x} y=${attrs.y} ${text.slice(0, 48)}`)
  }
}

if (failures) {
  console.error(`\n${failures} attribute(s) decoded with the wrong type`)
  process.exit(1)
}
console.log('\nAll board attributes decode with the correct types.')
