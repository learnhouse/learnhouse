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

  // Sticky elements (10-19)
  STICKY: 10,
  STICKY_HEADER: 15,

  // Interactive elements (20-29)
  INTERACTIVE: 20,
  DRAG_OVERLAY: 25,

  // Navigation (30-39)
  NAV: 30,
  NAV_MENU: 35,

  // Dropdowns and popovers (40-49)
  DROPDOWN: 40,
  POPOVER: 45,

  // Overlays (50-59)
  OVERLAY: 50,
  MODAL_BACKDROP: 55,

  // Modals (60-69)
  MODAL: 60,
  MODAL_CONTENT: 65,

  // Toasts and notifications (70-79)
  TOAST: 70,
  NOTIFICATION: 75,

  // Editor-specific layers (80-89)
  EDITOR_TOOLBAR: 80,
  EDITOR_BUBBLE: 85,

  // Critical elements (90-99)
  TOOLTIP: 90,
  CRITICAL: 95,
  MAX: 99,
} as const

// Type for z-index values
export type ZIndexKey = keyof typeof Z_INDEX
export type ZIndexValue = (typeof Z_INDEX)[ZIndexKey]

// Helper function to get z-index value
export function getZIndex(key: ZIndexKey): number {
  return Z_INDEX[key]
}

// Tailwind-compatible class names mapping
// Use these in className attributes: `z-${zClass.MODAL}`
export const zClass = {
  BEHIND: '[z-index:-10]',
  BACKGROUND: '[z-index:-1]',
  BASE: 'z-0',
  CONTENT: '[z-index:1]',
  ELEVATED: '[z-index:5]',
  STICKY: 'z-10',
  STICKY_HEADER: '[z-index:15]',
  INTERACTIVE: 'z-20',
  DRAG_OVERLAY: '[z-index:25]',
  NAV: 'z-30',
  NAV_MENU: '[z-index:35]',
  DROPDOWN: 'z-40',
  POPOVER: '[z-index:45]',
  OVERLAY: 'z-50',
  MODAL_BACKDROP: '[z-index:55]',
  MODAL: '[z-index:60]',
  MODAL_CONTENT: '[z-index:65]',
  TOAST: '[z-index:70]',
  NOTIFICATION: '[z-index:75]',
  EDITOR_TOOLBAR: '[z-index:80]',
  EDITOR_BUBBLE: '[z-index:85]',
  TOOLTIP: '[z-index:90]',
  CRITICAL: '[z-index:95]',
  MAX: '[z-index:99]',
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
