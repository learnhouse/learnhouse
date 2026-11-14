/**
 * The LearnHouse V2 design system: one import for new UI.
 *
 *   import { DashPage, DashPageHeader, Panel, Button, SubTabs, AIButton, tokens } from '@/design'
 *
 * Read design/DESIGN.md first. This file only re-exports: the components keep
 * living where dozens of pages already import them (DashKit, SubTabs,
 * AIBrand…), so both paths stay valid. Named exports only (no `export *`), so
 * the public surface is explicit and tests/design-tokens.test.mjs can check it
 * against DESIGN.md.
 */

// ── tokens and recipes (pure, server-safe) ──
export { tokens, color, radius, shadow, spacing, text, font, motion, zIndex, icon, layout, chartSeries, cssTokenList } from './tokens'
export type { Token, ColorRole } from './tokens'
export { recipes } from './recipes'
export type { Recipe } from './recipes'

// ── buttons ──
export { buttonClass } from '@components/Dashboard/Shared/DashKit/buttons'
export type { ButtonVariant, ButtonSize } from '@components/Dashboard/Shared/DashKit/buttons'

// ── DashKit ──
export {
  Button,
  BTN_PRIMARY,
  BTN_SECONDARY,
  BTN_GHOST,
  BTN_PRIMARY_SM,
  BTN_SECONDARY_SM,
  BTN_DANGER,
  INPUT,
  TEXTAREA,
  Chip,
  DashPageHeader,
  StatCard,
  SearchInput,
  SegmentedControl,
  ToolbarSelect,
  ViewToggle,
  useStoredState,
  EmptyState,
  BulkActionBar,
  BulkActionButton,
  OptionCard,
  ChoiceCard,
  FieldLabel,
  formatRelative,
  SectionCard,
  SettingRow,
  StickySaveBar,
  ConfirmDialog,
  AvatarStack,
} from '@components/Dashboard/Shared/DashKit/DashKit'
export type { ChipTone, ViewMode } from '@components/Dashboard/Shared/DashKit/DashKit'

// ── navigation ──
export { DashTabBar } from '@components/Dashboard/Shared/DashTabBar/DashTabBar'
export type { DashTabItem } from '@components/Dashboard/Shared/DashTabBar/DashTabBar'
export { SubTabs, SubTabPanel, useSubTab } from '@components/Dashboard/Shared/DashKit/SubTabs'
export type { SubTabItem, SubTabsVariant } from '@components/Dashboard/Shared/DashKit/SubTabs'
export { SUB_TAB_PARAM } from '@components/Dashboard/Shared/DashKit/subTabsUrl'
export { Breadcrumbs } from '@components/Objects/Breadcrumbs/Breadcrumbs'
export { default as Modal } from '@components/Objects/StyledElements/Modal/Modal'

// ── AI branding ──
export {
  AI_GRADIENT,
  AI_GRADIENT_LINEAR,
  AI_DARK_SURFACE,
  AIMark,
  AIMarkIcon,
  AIButton,
  AIButtonMark,
  aiButtonClass,
  AIChip,
  aiSurface,
  AIAccentLine,
  AISurfaceHeader,
  AIAvatar,
  AIThinking,
  AIShimmer,
} from '@components/Objects/AI/AIBrand'
export type { AIMarkVariant, AIButtonVariant, AIButtonSize } from '@components/Objects/AI/AIBrand'

// ── design-system additions (design/primitives.tsx) ──
export { DashPage, Panel, Toolbar, Eyebrow, StatusPill, StatusDot, STATUS_TONE, Skeleton } from './primitives'
export type { Status } from './primitives'
