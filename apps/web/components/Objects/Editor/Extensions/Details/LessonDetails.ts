import {
  Details as TiptapDetails,
  DetailsContent as TiptapDetailsContent,
  DetailsSummary as TiptapDetailsSummary,
} from '@tiptap/extension-details'

const wiredDisclosureButtons = new WeakSet<HTMLButtonElement>()

/**
 * Shared official TipTap disclosure nodes for course authoring and reading.
 * Keep the package version aligned with the rest of LearnHouse's TipTap 3.31.1
 * extensions so stored JSON uses the same schema in both surfaces.
 */
export const LessonDetails = [
  TiptapDetails.configure({
    persist: true,
    HTMLAttributes: { class: 'lesson-disclosure' },
    renderToggleButton: ({ element, isOpen, node }) => {
      const summary = node.childCount > 0 ? node.child(0).textContent.trim() : ''

      element.type = 'button'
      element.setAttribute('aria-label', summary || 'Supplementary content')
      element.setAttribute('aria-expanded', String(isOpen))
      element.setAttribute('data-details-toggle', '')

      // The upstream node view returns focus to the ProseMirror root after a
      // toggle. In the student reader that makes keyboard users lose their
      // place, and Enter is intercepted by the contenteditable parent. Keep
      // the native button operable and restore focus when it was the control
      // the user activated. Programmatic ToC clicks leave focus untouched.
      if (!wiredDisclosureButtons.has(element)) {
        wiredDisclosureButtons.add(element)

        const summaryObserver = new window.MutationObserver(() => {
          const currentSummary = element.parentElement?.querySelector<HTMLElement>(
            '.lesson-disclosure__summary'
          )
          const accessibleName = currentSummary?.textContent?.trim() || 'Supplementary content'

          if (element.getAttribute('aria-label') !== accessibleName) {
            element.setAttribute('aria-label', accessibleName)
          }
        })

        if (element.parentElement) {
          summaryObserver.observe(element.parentElement, {
            characterData: true,
            childList: true,
            subtree: true,
          })
        }

        element.addEventListener('keydown', (event: KeyboardEvent) => {
          if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'Spacebar') return

          event.preventDefault()
          event.stopPropagation()
          element.click()
        })

        element.addEventListener('click', () => {
          const restoreFocus = document.activeElement === element
          if (!restoreFocus) return

          window.requestAnimationFrame(() => {
            window.requestAnimationFrame(() => {
              if (element.isConnected) element.focus({ preventScroll: true })
            })
          })
        })
      }
    },
  }),
  TiptapDetailsSummary.configure({
    HTMLAttributes: { class: 'lesson-disclosure__summary' },
  }),
  TiptapDetailsContent.configure({
    HTMLAttributes: { class: 'lesson-disclosure__content' },
  }),
]
