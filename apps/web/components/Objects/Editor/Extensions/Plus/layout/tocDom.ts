/*
 Table of contents without an editor: read the headings a static render
 already wrote (StaticCanva and @learnhouse/react put the same ids on them as
 the editor's CustomHeading), and fill any server-rendered placeholder list
 (`[data-lh-toc-pending]`, from renderHTML without an editor).
*/
import { outlineEntries, type OutlineHeading } from './layoutModel'

export function headingsFromDom(root: Element | Document): OutlineHeading[] {
  return Array.from(root.querySelectorAll<HTMLElement>('h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]'))
    .filter((h) => !h.closest('[data-type="table-of-contents"], .lh-toc'))
    .map((h) => ({ level: Number(h.tagName.slice(1)), text: (h.textContent || '').trim(), id: h.id }))
}

/** Fill every pending table of contents under `root` from the headings under it. */
export function hydrateTableOfContents(root: Element | Document = document): number {
  let filled = 0
  root.querySelectorAll<HTMLElement>('nav[data-type="table-of-contents"]').forEach((nav) => {
    const list = nav.querySelector<HTMLElement>('[data-lh-toc-pending]')
    if (!list) return
    const entries = outlineEntries(headingsFromDom(root), nav.getAttribute('data-max-level'))
    const doc = nav.ownerDocument
    list.replaceChildren(
      ...entries.map((entry) => {
        const li = doc.createElement('li')
        li.setAttribute('data-depth', String(entry.depth))
        const a = doc.createElement('a')
        a.href = `#${entry.id}`
        a.textContent = entry.text
        li.appendChild(a)
        return li
      }),
    )
    list.removeAttribute('data-lh-toc-pending')
    filled += 1
  })
  return filled
}
