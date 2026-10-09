import {
  Details as TiptapDetails,
  DetailsContent as TiptapDetailsContent,
  DetailsSummary as TiptapDetailsSummary,
} from '@tiptap/extension-details'

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

      element.setAttribute('aria-label', summary || 'Supplementary content')
      element.setAttribute('aria-expanded', String(isOpen))
      element.setAttribute('data-details-toggle', '')
    },
  }),
  TiptapDetailsSummary.configure({
    HTMLAttributes: { class: 'lesson-disclosure__summary' },
  }),
  TiptapDetailsContent.configure({
    HTMLAttributes: { class: 'lesson-disclosure__content' },
  }),
]
