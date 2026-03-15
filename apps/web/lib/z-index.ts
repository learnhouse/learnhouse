/**
 * Z-Index Layering System
 *
 * This file defines a centralized z-index hierarchy for the entire application.
 * All z-index values should be imported from here to maintain consistency.
 *
 * LAYERING TIERS (from bottom to top):
 * - BASE: Default content, images, backgrounds
 * - CONTENT: Elevated content, cards, panels
 * - STICKY: Sticky headers, navigation bars
 * - DROPDOWN: Dropdowns, popovers, tooltips
 * - OVERLAY: Overlays, backdrops
 * - MODAL: Modal dialogs
 * - TOAST: Toast notifications
 * - CRITICAL: Critical UI elements that must always be on top
 */

// Base layer values - use these constants in TypeScript/JavaScript
export const Z_INDEX = {
  // Negative layers (backgrounds, decorative elements)
  BEHIND: -10,
  BACKGROUND: -1,

  // Base layers (0-10)
  BASE: 0,
  CONTENT: 1,
  ELEVATED: 5,

  // Sticky elements (10-25)
  STICKY: 10,
  STICKY_HEADER: 15,

  // Interactive elements (20-25)
  INTERACTIVE: 20,
  DRAG_OVERLAY: 25,

  // Navigation (highest values to always stay above page content)
  NAV: 9999,
  NAV_MENU: 10000,

  // Dropdowns and popovers
  DROPDOWN: 110,
  POPOVER: 250,

  // Overlays (120-125)
  OVERLAY: 120,
  MODAL_BACKDROP: 125,

  // Modals (130-135)
  MODAL: 130,
  MODAL_CONTENT: 135,

  // Toasts and notifications (140-145)
  TOAST: 140,
  NOTIFICATION: 145,

  // Editor-specific layers (150-155)
  EDITOR_TOOLBAR: 150,
  EDITOR_BUBBLE: 155,

  // Critical elements (160+)
  TOOLTIP: 160,
  CRITICAL: 165,
  MAX: 999,
} as const

// Type for z-index values
export type ZIndexKey = keyof typeof Z_INDEX
export type ZIndexValue = (typeof Z_INDEX)[ZIndexKey]

// Helper function to get z-index value
export function getZIndex(key: ZIndexKey): number {
  return Z_INDEX[key]
}

// Tailwind-compatible class names mapping
// Use these in className attributes - prefer using z-{name} from tailwind config
export const zClass = {
  BEHIND: 'z-behind',
  BACKGROUND: 'z-background',
  BASE: 'z-base',
  CONTENT: 'z-content',
  ELEVATED: 'z-elevated',
  STICKY: 'z-sticky',
  STICKY_HEADER: 'z-sticky-header',
  INTERACTIVE: 'z-interactive',
  DRAG_OVERLAY: 'z-drag-overlay',
  NAV: 'z-nav',
  NAV_MENU: 'z-nav-menu',
  DROPDOWN: 'z-dropdown',
  POPOVER: 'z-popover',
  OVERLAY: 'z-overlay',
  MODAL_BACKDROP: 'z-modal-backdrop',
  MODAL: 'z-modal',
  MODAL_CONTENT: 'z-modal-content',
  TOAST: 'z-toast',
  NOTIFICATION: 'z-notification',
  EDITOR_TOOLBAR: 'z-editor-toolbar',
  EDITOR_BUBBLE: 'z-editor-bubble',
  TOOLTIP: 'z-tooltip',
  CRITICAL: 'z-critical',
  MAX: 'z-max',
} as const

// CSS custom properties for use in CSS/styled-components
// These are defined in globals.css as --z-{name}
export const zVar = {
  BEHIND: 'var(--z-behind)',
  BACKGROUND: 'var(--z-background)',
  BASE: 'var(--z-base)',
  CONTENT: 'var(--z-content)',
  ELEVATED: 'var(--z-elevated)',
  STICKY: 'var(--z-sticky)',
  STICKY_HEADER: 'var(--z-sticky-header)',
  INTERACTIVE: 'var(--z-interactive)',
  DRAG_OVERLAY: 'var(--z-drag-overlay)',
  NAV: 'var(--z-nav)',
  NAV_MENU: 'var(--z-nav-menu)',
  DROPDOWN: 'var(--z-dropdown)',
  POPOVER: 'var(--z-popover)',
  OVERLAY: 'var(--z-overlay)',
  MODAL_BACKDROP: 'var(--z-modal-backdrop)',
  MODAL: 'var(--z-modal)',
  MODAL_CONTENT: 'var(--z-modal-content)',
  TOAST: 'var(--z-toast)',
  NOTIFICATION: 'var(--z-notification)',
  EDITOR_TOOLBAR: 'var(--z-editor-toolbar)',
  EDITOR_BUBBLE: 'var(--z-editor-bubble)',
  TOOLTIP: 'var(--z-tooltip)',
  CRITICAL: 'var(--z-critical)',
  MAX: 'var(--z-max)',
} as const
