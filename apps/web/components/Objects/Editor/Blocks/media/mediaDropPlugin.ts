/*
 Drop or paste files anywhere in the editor; paste a link to embed it.

 - Dragging files over the page draws a line between blocks where they will
   land (top-level boundaries only, so a drop never splits a paragraph).
 - Each valid file becomes an upload placeholder at that spot: a widget
   DECORATION, i.e. local view state that is not part of the document and is
   never synced to collaborators. When the server has stored the file, the
   real block is inserted once, with its final attrs, at the placeholder's
   (mapped) position. Failed uploads stay as a placeholder with Retry.
 - Files that can't be accepted are rejected up front with the reason.
 - Pasting a lone link from a known service (YouTube, Vimeo, Loom, Figma,
   Google Docs/Slides, CodePen, …) on an empty line turns it into an embed,
   with a one-click "Keep as link".
*/
import type { Editor } from '@tiptap/core'
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import React from 'react'
import toast from 'react-hot-toast'
import i18n from '@/lib/i18n'
import { MEDIA_KINDS, MediaKind, formatBytes, validateFile } from './mediaKinds'
import {
  cancelUpload,
  discardUpload,
  getUploadTask,
  retryUpload,
  startUpload,
  subscribeUploads,
} from './uploadStore'
import { uploadErrorText } from './uploadMessages'
import { embedAttrsFor, normalizeUserUrl, parseEmbedUrl } from '../embeds/embedProviders'

export const mediaDropKey = new PluginKey<DecorationSet>('lhMediaDrop')

type Meta = { add?: { id: string; pos: number; index: number }; remove?: string }

export interface MediaDropOptions {
  editor: Editor
  getActivity: () => any
  getAccessToken: () => string | undefined
}

// ─── Block boundaries ──────────────────────────────────────────────────────

export interface Boundary {
  pos: number
  y: number
  left: number
  width: number
}

/** The top-level gap closest to clientY, with where to draw the line. */
export function boundaryAt(view: EditorView, clientY: number): Boundary | null {
  const { doc } = view.state
  const editorRect = view.dom.getBoundingClientRect()
  let best: Boundary | null = null
  let bestDist = Infinity
  let pos = 0
  const consider = (p: number, y: number) => {
    const d = Math.abs(clientY - y)
    if (d < bestDist) {
      bestDist = d
      best = { pos: p, y, left: editorRect.left, width: editorRect.width }
    }
  }
  if (doc.childCount === 0) return { pos: 0, y: editorRect.top, left: editorRect.left, width: editorRect.width }
  doc.forEach((node, offset) => {
    pos = offset
    const dom = view.nodeDOM(offset) as HTMLElement | null
    if (!dom || typeof dom.getBoundingClientRect !== 'function') return
    const rect = dom.getBoundingClientRect()
    consider(offset, rect.top - 4)
    consider(offset + node.nodeSize, rect.bottom + 4)
  })
  void pos
  return best
}

// ─── Placeholder widget ────────────────────────────────────────────────────

const ICONS: Record<MediaKind, string> = {
  image: 'M216,40H40A16,16,0,0,0,24,56V200a16,16,0,0,0,16,16H216a16,16,0,0,0,16-16V56A16,16,0,0,0,216,40Zm0,16V158.75l-26.07-26.06a16,16,0,0,0-22.63,0l-20,20-44-44a16,16,0,0,0-22.62,0L40,149.37V56ZM40,172l52-52,80,80H40Zm176,28H194.63l-36-36,20-20L216,181.38V200ZM144,100a12,12,0,1,1,12,12A12,12,0,0,1,144,100Z',
  video: 'M251.77,73a8,8,0,0,0-8.21.39L208,97.05V72a16,16,0,0,0-16-16H32A16,16,0,0,0,16,72V184a16,16,0,0,0,16,16H192a16,16,0,0,0,16-16V159l35.56,23.71A8,8,0,0,0,248,184a8,8,0,0,0,8-8V80A8,8,0,0,0,251.77,73ZM192,184H32V72H192V184Zm48-22.95-32-21.33V116.28L240,95Z',
  audio: 'M201.89,54.66A103.43,103.43,0,0,0,128.79,24H128A104,104,0,0,0,24,128v56a24,24,0,0,0,24,24H64a24,24,0,0,0,24-24V144a24,24,0,0,0-24-24H40.36A88.12,88.12,0,0,1,190.54,65.93,87.39,87.39,0,0,1,215.65,120H192a24,24,0,0,0-24,24v40a24,24,0,0,0,24,24h24a24,24,0,0,0,24-24V128A103.41,103.41,0,0,0,201.89,54.66ZM64,136a8,8,0,0,1,8,8v40a8,8,0,0,1-8,8H48a8,8,0,0,1-8-8V136Zm160,48a8,8,0,0,1-8,8H192a8,8,0,0,1-8-8V144a8,8,0,0,1,8-8h24Z',
  pdf: 'M213.66,82.34l-56-56A8,8,0,0,0,152,24H56A16,16,0,0,0,40,40V216a16,16,0,0,0,16,16H200a16,16,0,0,0,16-16V88A8,8,0,0,0,213.66,82.34ZM160,51.31,188.69,80H160ZM200,216H56V40h88V88a8,8,0,0,0,8,8h48V216Z',
}

function svgIcon(kind: MediaKind) {
  return `<svg width="20" height="20" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="${ICONS[kind]}"/></svg>`
}

function renderPlaceholder(el: HTMLElement, id: string, onRemove: () => void) {
  const task = getUploadTask(id)
  if (!task) return
  const failed = task.status === 'error'
  el.className = `lh-upload-placeholder${failed ? ' is-error' : ''}${task.status === 'processing' ? ' is-processing' : ''}`
  el.setAttribute('aria-live', 'polite')
  const pct = Math.round(task.progress)

  const thumb = document.createElement('div')
  thumb.className = 'lh-up-thumb'
  if (task.previewUrl) thumb.style.backgroundImage = `url("${task.previewUrl}")`
  else thumb.innerHTML = svgIcon(task.kind)

  const body = document.createElement('div')
  body.className = 'lh-up-body'
  const name = document.createElement('div')
  name.className = 'lh-up-name'
  name.textContent = task.fileName
  const meta = document.createElement('div')
  meta.className = 'lh-up-meta'
  meta.textContent = failed
    ? uploadErrorText(i18n.t, { code: task.errorCode, kind: task.kind, fileSize: task.fileSize, error: task.error })
    : task.status === 'preparing'
      ? i18n.t('editor.blocks_v2.preparing', 'Preparing…')
      : task.status === 'processing'
        ? i18n.t('editor.blocks_v2.processing', 'Finishing up…')
        : i18n.t('editor.blocks_v2.progress', '{{percent}}% of {{size}}', { percent: pct, size: formatBytes(task.fileSize) })
  body.append(name, meta)
  if (!failed) {
    const bar = document.createElement('div')
    bar.className = 'lh-up-bar'
    bar.setAttribute('role', 'progressbar')
    bar.setAttribute('aria-valuenow', String(pct))
    bar.setAttribute('aria-valuemin', '0')
    bar.setAttribute('aria-valuemax', '100')
    const fill = document.createElement('span')
    fill.style.width = `${task.status === 'preparing' ? 2 : Math.max(2, pct)}%`
    bar.append(fill)
    body.append(bar)
  }

  const actions = document.createElement('div')
  actions.className = 'lh-up-actions'
  const button = (label: string, action: string, onClick: () => void) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.textContent = label
    b.dataset.action = action
    b.addEventListener('mousedown', (e) => e.preventDefault())
    b.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      onClick()
    })
    return b
  }
  if (failed) {
    if (task.errorCode !== 'type' && task.errorCode !== 'size') {
      actions.append(button(i18n.t('editor.blocks_v2.retry', 'Retry'), 'retry', () => retryUpload(id)))
    }
    actions.append(button(i18n.t('editor.blocks_v2.dismiss', 'Dismiss'), 'dismiss', onRemove))
  } else {
    actions.append(
      button(i18n.t('editor.blocks.common.cancel', 'Cancel'), 'cancel', () => {
        cancelUpload(id)
        onRemove()
      }),
    )
  }
  el.replaceChildren(thumb, body, actions)
}

// ─── Plugin ────────────────────────────────────────────────────────────────

function nodeFor(state: EditorState, kind: MediaKind, result: any) {
  const type = state.schema.nodes[MEDIA_KINDS[kind].nodeType]
  if (!type) return null
  switch (kind) {
    case 'image':
      return type.create({ blockObject: result, size: { width: 560 } })
    case 'video':
      return type.create({ blockObject: { ...result, size: 'medium' } })
    case 'audio':
      return type.create({ blockObject: { ...result, source_type: 'upload', size: 'medium' } })
    default:
      return type.create({ blockObject: result })
  }
}

function findPlaceholder(state: EditorState, id: string): number | null {
  const set = mediaDropKey.getState(state)
  const found = set?.find(undefined, undefined, (spec) => spec.uploadId === id)
  return found && found.length ? found[0].from : null
}

export function createMediaDropPlugin(opts: MediaDropOptions) {
  let indicator: HTMLDivElement | null = null
  let counter = 0

  const hideIndicator = () => {
    indicator?.classList.remove('visible')
    document.body.classList.remove('lh-file-dragging')
  }

  const removePlaceholder = (view: EditorView, id: string) => {
    discardUpload(id)
    if (view.isDestroyed) return
    view.dispatch(view.state.tr.setMeta(mediaDropKey, { remove: id } as Meta))
  }

  const insertResult = (view: EditorView, id: string, kind: MediaKind, result: any) => {
    if (view.isDestroyed) return
    const pos = findPlaceholder(view.state, id)
    const node = nodeFor(view.state, kind, result)
    let tr: Transaction = view.state.tr.setMeta(mediaDropKey, { remove: id } as Meta)
    if (pos != null && node) {
      const after = tr.doc.nodeAt(pos)
      // Pasting into an empty line replaces that line instead of leaving it.
      if (after && after.type.name === 'paragraph' && after.content.size === 0 && after === tr.doc.resolve(pos).nodeAfter && tr.doc.resolve(pos).depth === 0) {
        tr = tr.replaceWith(pos, pos + after.nodeSize, node)
      } else {
        tr = tr.insert(pos, node)
      }
    }
    view.dispatch(tr)
    discardUpload(id)
  }

  const handleFiles = (view: EditorView, files: File[], pos: number): boolean => {
    const activity = opts.getActivity()
    if (!activity?.activity_uuid || !opts.getAccessToken()) return false
    let handled = false
    const rejected: string[] = []
    files.forEach((file) => {
      const check = validateFile(file)
      if (!check.ok && !(check.kind === 'image' && check.code === 'size')) {
        handled = true
        rejected.push(`${file.name}: ${uploadErrorText(i18n.t, { code: check.code, kind: check.kind, fileSize: file.size, maxBytes: check.ok ? undefined : check.maxBytes })}`)
        return
      }
      const kind = (check.ok ? check.kind : check.kind) as MediaKind
      handled = true
      const id = startUpload({
        kind,
        file,
        activityUuid: activity.activity_uuid,
        getToken: opts.getAccessToken,
        onDone: (result) => insertResult(view, id, kind, result),
      })
      counter += 1
      view.dispatch(view.state.tr.setMeta(mediaDropKey, { add: { id, pos, index: counter } } as Meta))
    })
    if (rejected.length) toast.error(rejected.join('\n'), { duration: 6000 })
    return handled
  }

  const tryEmbedPaste = (view: EditorView, text: string): boolean => {
    const url = normalizeUserUrl(text)
    if (!url) return false
    const parsed = parseEmbedUrl(url)
    if (!parsed) return false
    const { state } = view
    const { $from, empty } = state.selection
    // Only on an empty top-level line; inside text a link stays a link.
    if (!empty || $from.depth !== 1 || $from.parent.type.name !== 'paragraph' || $from.parent.content.size !== 0) return false
    const embedType = state.schema.nodes.blockEmbed
    if (!embedType) return false
    const start = $from.before(1)
    const node = embedType.create(embedAttrsFor(parsed))
    view.dispatch(state.tr.replaceWith(start, start + $from.parent.nodeSize, node).scrollIntoView())

    const keepAsLink = () => {
      if (view.isDestroyed) return
      let found: number | null = null
      view.state.doc.forEach((child, offset) => {
        if (child.type.name === 'blockEmbed' && child.attrs.embedSourceUrl === parsed.sourceUrl) found = offset
      })
      if (found == null) return
      const at: number = found
      const embedNode = view.state.doc.nodeAt(at)
      const linkMark = view.state.schema.marks.link
      if (!embedNode) return
      const textNode = view.state.schema.text(text, linkMark ? [linkMark.create({ href: parsed.sourceUrl })] : [])
      const para = view.state.schema.nodes.paragraph.create(null, textNode)
      view.dispatch(view.state.tr.replaceWith(at, at + embedNode.nodeSize, para))
    }
    toast(
      (tst) =>
        React.createElement(
          'span',
          { className: 'flex items-center gap-3 text-[13px]' },
          i18n.t('editor.blocks_v2.embedded', 'Embedded from {{provider}}', { provider: parsed.label }),
          React.createElement(
            'button',
            {
              type: 'button',
              className: 'rounded-md px-2 py-1 text-xs font-medium text-neutral-700 ring-1 ring-black/10 hover:bg-neutral-50',
              onClick: () => {
                keepAsLink()
                toast.dismiss(tst.id)
              },
            },
            i18n.t('editor.blocks_v2.keep_as_link', 'Keep as link'),
          ),
        ),
      { duration: 6000 },
    )
    return true
  }

  return new Plugin<DecorationSet>({
    key: mediaDropKey,
    state: {
      init: () => DecorationSet.empty,
      apply(tr, set) {
        let next = set.map(tr.mapping, tr.doc)
        const meta = tr.getMeta(mediaDropKey) as Meta | undefined
        if (meta?.add) {
          const { id, pos, index } = meta.add
          const safePos = Math.max(0, Math.min(pos, tr.doc.content.size))
          const deco = Decoration.widget(
            safePos,
            (view) => {
              const el = document.createElement('div')
              el.contentEditable = 'false'
              el.dataset.uploadId = id
              const rerender = () => renderPlaceholder(el, id, () => removePlaceholder(view, id))
              rerender()
              ;(el as any)._lhUnsub = subscribeUploads(rerender)
              return el
            },
            {
              uploadId: id,
              key: id,
              side: index,
              ignoreSelection: true,
              destroy: (dom: Node) => {
                ;(dom as any)?._lhUnsub?.()
              },
            },
          )
          next = next.add(tr.doc, [deco])
        }
        if (meta?.remove) {
          next = next.remove(next.find(undefined, undefined, (spec) => spec.uploadId === meta.remove))
        }
        return next
      },
    },
    view(view) {
      indicator = document.createElement('div')
      indicator.className = 'lh-file-drop-indicator'
      document.body.appendChild(indicator)
      const onDocDragEnd = () => hideIndicator()
      document.addEventListener('drop', onDocDragEnd, true)
      document.addEventListener('dragend', onDocDragEnd, true)
      return {
        destroy() {
          document.removeEventListener('drop', onDocDragEnd, true)
          document.removeEventListener('dragend', onDocDragEnd, true)
          indicator?.remove()
          indicator = null
          document.body.classList.remove('lh-file-dragging')
          void view
        },
      }
    },
    props: {
      decorations(state) {
        return mediaDropKey.getState(state)
      },
      handleDOMEvents: {
        dragover(view, event) {
          const dt = (event as DragEvent).dataTransfer
          if (!dt || !Array.from(dt.types || []).includes('Files') || !view.editable) return false
          const target = event.target as HTMLElement | null
          if (target?.closest?.('[data-lh-dropzone]')) {
            hideIndicator()
            return false
          }
          event.preventDefault()
          dt.dropEffect = 'copy'
          const b = boundaryAt(view, (event as DragEvent).clientY)
          if (b && indicator) {
            indicator.style.left = `${b.left}px`
            indicator.style.width = `${b.width}px`
            indicator.style.top = `${b.y - 1}px`
            indicator.classList.add('visible')
            document.body.classList.add('lh-file-dragging')
          }
          return false
        },
        dragleave(view, event) {
          const related = (event as DragEvent).relatedTarget as Node | null
          if (!related || !view.dom.contains(related)) hideIndicator()
          return false
        },
      },
      handleDrop(view, event, _slice, moved) {
        hideIndicator()
        if (moved) return false
        const dt = (event as DragEvent).dataTransfer
        const files = dt?.files ? Array.from(dt.files) : []
        if (!files.length) return false
        const target = event.target as HTMLElement | null
        if (target?.closest?.('[data-lh-dropzone]')) return false
        const b = boundaryAt(view, (event as DragEvent).clientY)
        const handled = handleFiles(view, files, b?.pos ?? view.state.doc.content.size)
        if (handled) event.preventDefault()
        return handled
      },
      handlePaste(view, event) {
        const cd = event.clipboardData
        if (!cd) return false
        const files = cd.files ? Array.from(cd.files) : []
        const text = cd.getData('text/plain') || ''
        const html = cd.getData('text/html') || ''
        if (files.length) {
          // Office apps put an image of the selection next to the real text;
          // only take the files when there's no text to paste instead.
          const onlyImageHtml = !html || /^\s*(<meta[^>]*>)?\s*<img[^>]*>\s*$/i.test(html.replace(/<\/?(html|body|head)[^>]*>|<!--[\s\S]*?-->/gi, ''))
          if (!text.trim() || onlyImageHtml) {
            const { $from } = view.state.selection
            const pos = $from.depth >= 1 ? ($from.parent.content.size === 0 && $from.depth === 1 ? $from.before(1) : $from.after(1)) : view.state.selection.from
            return handleFiles(view, files, pos)
          }
        }
        if (text && !files.length) {
          const stripped = html.replace(/<[^>]+>/g, '').trim()
          if (!html || stripped === text.trim()) return tryEmbedPaste(view, text.trim())
        }
        return false
      },
    },
  })
}
