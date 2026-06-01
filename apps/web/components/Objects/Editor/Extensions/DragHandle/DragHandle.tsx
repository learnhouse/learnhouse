import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { EditorView } from '@tiptap/pm/view'
import { NodeSelection } from '@tiptap/pm/state'
import { Slice, Fragment, Node as PMNode } from '@tiptap/pm/model'

const DRAG_HANDLE_KEY = new PluginKey('dragHandle')

// Copy a single block to the system clipboard so it can be pasted into another
// TipTap editor instance. We use view.serializeForClipboard so ProseMirror
// embeds the slice metadata it needs for native paste to round-trip exactly.
function copyBlockToClipboard(view: EditorView, node: PMNode, button: HTMLElement) {
  const slice = new Slice(Fragment.from(node), 0, 0)
  const { dom, text } = view.serializeForClipboard(slice)
  const html = (dom as HTMLElement).outerHTML

  const onCopy = (event: ClipboardEvent) => {
    event.preventDefault()
    event.clipboardData?.setData('text/html', html)
    event.clipboardData?.setData('text/plain', text)
  }

  document.addEventListener('copy', onCopy, { once: true })
  const succeeded = document.execCommand('copy')

  if (!succeeded) {
    document.removeEventListener('copy', onCopy)
    navigator.clipboard?.writeText(text).catch(() => {})
  }

  const tooltip = button.querySelector('.tooltip-text') as HTMLElement | null
  if (tooltip) {
    const original = tooltip.textContent
    tooltip.textContent = 'Copied!'
    setTimeout(() => {
      if (tooltip.textContent === 'Copied!') tooltip.textContent = original
    }, 1200)
  }
}

function createDragHandlePlugin() {
  let dragHandle: HTMLElement | null = null
  let dropIndicator: HTMLElement | null = null
  let hoveredBlock: HTMLElement | null = null
  let draggedBlockPos: number | null = null
  let hideTimeout: ReturnType<typeof setTimeout> | null = null

  function init(view: EditorView) {
    // Create drag handle
    dragHandle = document.createElement('div')
    dragHandle.className = 'editor-drag-handle nice-shadow'
    dragHandle.innerHTML = `
      <div class="drag-grip" draggable="true">
        <svg width="14" height="14" viewBox="0 0 256 256" fill="currentColor">
          <path d="M104,60A12,12,0,1,1,92,48,12,12,0,0,1,104,60Zm60,12a12,12,0,1,0-12-12A12,12,0,0,0,164,72ZM92,116a12,12,0,1,0,12,12A12,12,0,0,0,92,116Zm72,0a12,12,0,1,0,12,12A12,12,0,0,0,164,116ZM92,184a12,12,0,1,0,12,12A12,12,0,0,0,92,184Zm72,0a12,12,0,1,0,12,12A12,12,0,0,0,164,184Z"/>
        </svg>
      </div>
      <button class="action-btn clear-btn" data-action="clear">
        <svg width="14" height="14" viewBox="0 0 256 256" fill="currentColor">
          <path d="M224,128a96,96,0,0,1-94.71,96H128A95.38,95.38,0,0,1,62.1,197.8a8,8,0,0,1,11-11.63A80,80,0,1,0,71.43,71.39a3.07,3.07,0,0,1-.26.25L44.59,96H72a8,8,0,0,1,0,16H24a8,8,0,0,1-8-8V56a8,8,0,0,1,16,0V85.8L60.25,60A96,96,0,0,1,224,128Z"/>
        </svg>
        <span class="tooltip-text">Clear</span>
      </button>
      <button class="action-btn duplicate-btn" data-action="duplicate">
        <svg width="14" height="14" viewBox="0 0 256 256" fill="currentColor">
          <path d="M216,32H88a8,8,0,0,0-8,8V80H40a8,8,0,0,0-8,8V216a8,8,0,0,0,8,8H168a8,8,0,0,0,8-8V176h40a8,8,0,0,0,8-8V40A8,8,0,0,0,216,32ZM160,208H48V96H160Zm48-48H176V88a8,8,0,0,0-8-8H96V48H208Z"/>
        </svg>
        <span class="tooltip-text">Duplicate</span>
      </button>
      <button class="action-btn copy-btn" data-action="copy">
        <svg width="14" height="14" viewBox="0 0 256 256" fill="currentColor">
          <path d="M168,152a8,8,0,0,1-8,8H96a8,8,0,0,1,0-16h64A8,8,0,0,1,168,152Zm-8-40H96a8,8,0,0,0,0,16h64a8,8,0,0,0,0-16Zm56-64V216a16,16,0,0,1-16,16H56a16,16,0,0,1-16-16V48A16,16,0,0,1,56,32H92.26a47.92,47.92,0,0,1,71.48,0H200A16,16,0,0,1,216,48ZM96,64h64a32,32,0,0,0-64,0ZM200,48H173.25A47.93,47.93,0,0,1,176,64v8a8,8,0,0,1-8,8H88a8,8,0,0,1-8-8V64a47.93,47.93,0,0,1,2.75-16H56V216H200Z"/>
        </svg>
        <span class="tooltip-text">Copy</span>
      </button>
      <button class="action-btn delete-btn" data-action="delete">
        <svg width="14" height="14" viewBox="0 0 256 256" fill="currentColor">
          <path d="M216,48H176V40a24,24,0,0,0-24-24H104A24,24,0,0,0,80,40v8H40a8,8,0,0,0,0,16h8V208a16,16,0,0,0,16,16H192a16,16,0,0,0,16-16V64h8a8,8,0,0,0,0-16ZM96,40a8,8,0,0,1,8-8h48a8,8,0,0,1,8,8v8H96Zm96,168H64V64H192ZM112,104v64a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Zm48,0v64a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Z"/>
        </svg>
        <span class="tooltip-text">Delete</span>
      </button>
    `
    document.body.appendChild(dragHandle)

    // Create drop indicator
    dropIndicator = document.createElement('div')
    dropIndicator.className = 'editor-drop-indicator'
    document.body.appendChild(dropIndicator)

    // Event listeners on editor
    view.dom.addEventListener('mousemove', handleMouseMove)
    view.dom.addEventListener('mouseleave', handleMouseLeave)

    // Event listeners on drag handle
    const dragGrip = dragHandle.querySelector('.drag-grip') as HTMLElement
    const actionButtons = dragHandle.querySelectorAll('.action-btn') as NodeListOf<HTMLElement>

    dragHandle.addEventListener('mouseenter', handleHandleEnter)
    dragHandle.addEventListener('mouseleave', handleHandleLeave)
    dragHandle.addEventListener('click', handleActionClick)
    dragGrip.addEventListener('dragstart', handleDragStart)
    dragGrip.addEventListener('dragend', handleDragEnd)

    // Add tooltip positioning for each button
    actionButtons.forEach(button => {
      button.addEventListener('mouseenter', handleButtonHover)
      button.addEventListener('mouseleave', handleButtonLeave)
    })

    // Global drag events for drop positioning
    document.addEventListener('dragover', handleDragOver)
    document.addEventListener('drop', handleDrop)

    function handleMouseMove(event: MouseEvent) {
      if (!view.editable || draggedBlockPos !== null) return

      const target = event.target as HTMLElement
      const block = findBlock(target, view)

      if (block) {
        hoveredBlock = block
        positionHandle(block)
        showHandle()
      }
    }

    function handleMouseLeave() {
      scheduleHide()
    }

    function handleHandleEnter() {
      clearHideTimeout()
    }

    function handleHandleLeave() {
      if (draggedBlockPos === null) {
        scheduleHide()
      }
    }

    function handleButtonHover(event: MouseEvent) {
      const button = event.currentTarget as HTMLElement
      const tooltip = button.querySelector('.tooltip-text') as HTMLElement
      if (tooltip) {
        const buttonRect = button.getBoundingClientRect()
        tooltip.style.left = `${buttonRect.left + buttonRect.width / 2}px`
        tooltip.style.top = `${buttonRect.top - 32}px`
      }
    }

    function handleButtonLeave() {
      // Tooltip hiding is handled by CSS
    }

    function handleActionClick(event: MouseEvent) {
      const target = event.target as HTMLElement
      const button = target.closest('button[data-action]') as HTMLElement

      if (!button) return

      event.preventDefault()
      event.stopPropagation()

      const action = button.dataset.action

      if (!hoveredBlock) return

      const nodePos = getNodePos(hoveredBlock, view)
      if (nodePos === null) return

      const node = view.state.doc.nodeAt(nodePos)
      if (!node) return

      if (action === 'delete') {
        const tr = view.state.tr.delete(nodePos, nodePos + node.nodeSize)
        view.dispatch(tr)
      } else if (action === 'duplicate') {
        const slice = new Slice(Fragment.from(node), 0, 0)
        const tr = view.state.tr.insert(nodePos + node.nodeSize, slice.content)
        view.dispatch(tr)
      } else if (action === 'copy') {
        copyBlockToClipboard(view, node, button)
        return
      } else if (action === 'clear') {
        // Create an empty version of the same node type
        const emptyNode = view.state.schema.nodes[node.type.name].create(
          node.attrs,
          null,
          node.marks
        )
        const tr = view.state.tr.replaceWith(nodePos, nodePos + node.nodeSize, emptyNode)
        view.dispatch(tr)
      }

      hideHandle()
    }

    function handleDragStart(event: DragEvent) {
      if (!hoveredBlock || !event.dataTransfer) return

      try {
        // Get node position - try multiple methods
        let nodePos = getNodePos(hoveredBlock, view)
        if (nodePos === null) return

        const node = view.state.doc.nodeAt(nodePos)
        if (!node) return

        draggedBlockPos = nodePos

        // Set drag data
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData('text/plain', '')

        // Create drag image
        const dragImage = hoveredBlock.cloneNode(true) as HTMLElement
        dragImage.style.position = 'absolute'
        dragImage.style.top = '-9999px'
        dragImage.style.opacity = '0.8'
        dragImage.style.background = 'white'
        dragImage.style.padding = '8px'
        dragImage.style.borderRadius = '4px'
        dragImage.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)'
        dragImage.style.maxWidth = '300px'
        document.body.appendChild(dragImage)
        event.dataTransfer.setDragImage(dragImage, 20, 20)
        setTimeout(() => dragImage.remove(), 0)

        // Select the node
        const selection = NodeSelection.create(view.state.doc, nodePos)
        view.dispatch(view.state.tr.setSelection(selection))

        // Visual feedback
        hoveredBlock.classList.add('is-dragging')
        dragHandle?.classList.add('is-dragging')
      } catch (e) {
        console.error('Drag start failed:', e)
        draggedBlockPos = null
      }
    }

    function handleDragEnd() {
      // Cleanup
      hoveredBlock?.classList.remove('is-dragging')
      dragHandle?.classList.remove('is-dragging')
      dropIndicator?.classList.remove('visible')
      draggedBlockPos = null
      hideHandle()
    }

    function handleDragOver(event: DragEvent) {
      if (draggedBlockPos === null) return

      event.preventDefault()
      event.dataTransfer!.dropEffect = 'move'

      const dropTarget = getDropTarget(event.clientY, view)
      if (dropTarget) {
        showDropIndicator(dropTarget.rect, dropTarget.position, view)
      } else {
        dropIndicator?.classList.remove('visible')
      }
    }

    function handleDrop(event: DragEvent) {
      if (draggedBlockPos === null) return

      event.preventDefault()

      const dropTarget = getDropTarget(event.clientY, view)
      if (!dropTarget) return

      try {
        const { state } = view
        const node = state.doc.nodeAt(draggedBlockPos)
        if (!node) return

        const nodeSize = node.nodeSize
        let targetPos = dropTarget.pos

        // Check if dropping at same position
        if (targetPos === draggedBlockPos || targetPos === draggedBlockPos + nodeSize) {
          return
        }

        // Create slice from the node
        const slice = new Slice(Fragment.from(node), 0, 0)

        // Build transaction
        let tr = state.tr

        // Adjust for position changes
        if (targetPos > draggedBlockPos) {
          // Moving down: delete first, adjust target
          tr = tr.delete(draggedBlockPos, draggedBlockPos + nodeSize)
          targetPos = targetPos - nodeSize
        } else {
          // Moving up: delete after insert position is calculated
          tr = tr.delete(draggedBlockPos, draggedBlockPos + nodeSize)
        }

        // Insert at new position
        tr = tr.insert(targetPos, slice.content)

        view.dispatch(tr)
      } catch (e) {
        console.error('Drop failed:', e)
      }
    }

    // Find the top-level block element containing the target
    function findBlock(target: HTMLElement, view: EditorView): HTMLElement | null {
      let el: HTMLElement | null = target
      const editorDom = view.dom

      // Traverse up to find the direct child of the ProseMirror editor
      while (el && el.parentElement) {
        // If the parent is the editor DOM, we found our block
        if (el.parentElement === editorDom) {
          return el
        }
        el = el.parentElement
      }

      return null
    }

    // Get the ProseMirror node position for a DOM element
    function getNodePos(element: HTMLElement, view: EditorView): number | null {
      try {
        // First try: direct posAtDOM
        const pos = view.posAtDOM(element, 0)
        const $pos = view.state.doc.resolve(pos)

        // Get the position at the start of the parent block
        if ($pos.depth > 0) {
          return $pos.before($pos.depth)
        }
        return pos
      } catch {
        // Fallback: try to find position by iterating through children
        const children = Array.from(view.dom.children)
        const index = children.indexOf(element)

        if (index === -1) return null

        // Calculate position by summing up previous node sizes
        let pos = 0
        view.state.doc.forEach((node, offset, i) => {
          if (i < index) {
            pos = offset + node.nodeSize
          }
        })

        // Verify this position has a node
        if (index === 0) {
          return 0
        }

        let currentPos = 0
        for (let i = 0; i < view.state.doc.childCount; i++) {
          if (i === index) {
            return currentPos
          }
          currentPos += view.state.doc.child(i).nodeSize
        }

        return null
      }
    }

    function getDropTarget(clientY: number, view: EditorView): { pos: number; rect: DOMRect; position: 'before' | 'after' } | null {
      const children = Array.from(view.dom.children) as HTMLElement[]

      let closestBlock: { element: HTMLElement; distance: number; position: 'before' | 'after' } | null = null

      for (let i = 0; i < children.length; i++) {
        const block = children[i]

        // Skip the currently dragged block
        if (block === hoveredBlock) continue
        // Skip non-element nodes
        if (block.nodeType !== Node.ELEMENT_NODE) continue

        const rect = block.getBoundingClientRect()
        const midY = rect.top + rect.height / 2

        // Calculate distance to top and bottom edges
        const distanceToTop = Math.abs(clientY - rect.top)
        const distanceToBottom = Math.abs(clientY - rect.bottom)
        const distanceToMid = Math.abs(clientY - midY)

        // Check if we're close to this block
        if (clientY >= rect.top - 30 && clientY <= rect.bottom + 30) {
          const position: 'before' | 'after' = clientY < midY ? 'before' : 'after'
          const distance = position === 'before' ? distanceToTop : distanceToBottom

          if (!closestBlock || distance < closestBlock.distance) {
            closestBlock = { element: block, distance, position }
          }
        }
      }

      if (!closestBlock) return null

      try {
        const nodePos = getNodePos(closestBlock.element, view)
        if (nodePos === null) return null

        const blockNode = view.state.doc.nodeAt(nodePos)
        if (!blockNode) return null

        return {
          pos: closestBlock.position === 'before' ? nodePos : nodePos + blockNode.nodeSize,
          rect: closestBlock.element.getBoundingClientRect(),
          position: closestBlock.position
        }
      } catch {
        return null
      }
    }

    function positionHandle(block: HTMLElement) {
      if (!dragHandle) return
      const rect = block.getBoundingClientRect()
      dragHandle.style.left = `${rect.left - 28}px`
      dragHandle.style.top = `${rect.top + 4}px`
    }

    function showHandle() {
      clearHideTimeout()
      dragHandle?.classList.add('visible')
    }

    function hideHandle() {
      dragHandle?.classList.remove('visible')
      hoveredBlock = null
    }

    function scheduleHide() {
      clearHideTimeout()
      hideTimeout = setTimeout(hideHandle, 200)
    }

    function clearHideTimeout() {
      if (hideTimeout) {
        clearTimeout(hideTimeout)
        hideTimeout = null
      }
    }

    function showDropIndicator(rect: DOMRect, position: 'before' | 'after', view: EditorView) {
      if (!dropIndicator) return

      const editorRect = view.dom.getBoundingClientRect()
      const y = position === 'before' ? rect.top : rect.bottom

      dropIndicator.style.left = `${editorRect.left + 10}px`
      dropIndicator.style.width = `${editorRect.width - 20}px`
      dropIndicator.style.top = `${y - 1}px`
      dropIndicator.classList.add('visible')
    }

    return {
      destroy() {
        const dragGrip = dragHandle?.querySelector('.drag-grip') as HTMLElement
        const actionButtons = dragHandle?.querySelectorAll('.action-btn') as NodeListOf<HTMLElement>

        view.dom.removeEventListener('mousemove', handleMouseMove)
        view.dom.removeEventListener('mouseleave', handleMouseLeave)
        dragHandle?.removeEventListener('mouseenter', handleHandleEnter)
        dragHandle?.removeEventListener('mouseleave', handleHandleLeave)
        dragHandle?.removeEventListener('click', handleActionClick)
        dragGrip?.removeEventListener('dragstart', handleDragStart)
        dragGrip?.removeEventListener('dragend', handleDragEnd)

        actionButtons?.forEach(button => {
          button.removeEventListener('mouseenter', handleButtonHover)
          button.removeEventListener('mouseleave', handleButtonLeave)
        })

        document.removeEventListener('dragover', handleDragOver)
        document.removeEventListener('drop', handleDrop)
        clearHideTimeout()
        dragHandle?.remove()
        dropIndicator?.remove()
      }
    }
  }

  return new Plugin({
    key: DRAG_HANDLE_KEY,
    view: init,
  })
}

export const DragHandle = Extension.create({
  name: 'dragHandle',

  addProseMirrorPlugins() {
    return [createDragHandlePlugin()]
  },
})

export default DragHandle
