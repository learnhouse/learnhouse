'use client'
import React from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { TabIcon } from '../tabIcon'
import { buildSubTabSearch, resolveSubTab, SUB_TAB_PARAM, subTabStorageKey } from './subTabsUrl'

// Second-level tabs for a page that already sits under the main DashTabBar.
// Use them instead of stacking every settings box in one long scroll.
//
//   const SECTIONS = ['general', 'thumbnail', 'learnings'] as const
//   const [section, setSection] = useSubTab('general', SECTIONS)
//
//   <SubTabs
//     items={[
//       { key: 'general', label: t('...'), icon: <Info size={15} /> },
//       { key: 'thumbnail', label: t('...'), dirty: thumbnailDirty },
//       { key: 'learnings', label: t('...'), badge: <Chip>3</Chip>, hidden: !canEdit },
//     ]}
//     value={section}
//     onChange={setSection}
//     variant="pills"            // or "sidebar" for pages with many sections
//   >
//     <SubTabPanel tab="general">...</SubTabPanel>
//     <SubTabPanel tab="thumbnail">...</SubTabPanel>
//     <SubTabPanel tab="learnings" unmountWhenHidden>...</SubTabPanel>
//   </SubTabs>
//
// - useSubTab keeps the open sub-tab in `?section=` (history.replaceState: no
//   navigation, no history entry), so deep links and back/forward between
//   pages land on the same sub-tab. With no param it reopens the sub-tab last
//   used on this page (per browser), else the default.
// - Panels mount the first time they open and then stay mounted (hidden), so
//   unsaved input survives a switch. Pass `unmountWhenHidden` for heavy panels.
// - Saving stays the page's business: keep one StickySaveBar / header Save
//   outside the panels, and set `dirty` on the items whose fields changed so
//   they show the amber dot.
// - "pills": a segmented row under the page header. "sidebar": a sticky
//   vertical nav on the start side from lg up, pills below that.
// - Children are optional: without them only the tab row renders and the
//   page lays out <SubTabPanel value={section} tab="..."> itself.
// - With fewer than two visible items the row is not drawn (panels still are).

export type SubTabItem<K extends string = string> = {
  key: K
  label: React.ReactNode
  icon?: React.ReactNode
  // Trailing content: a count, a plan badge.
  badge?: React.ReactNode
  hidden?: boolean
  disabled?: boolean
  // Shows the amber "unsaved" dot.
  dirty?: boolean
}

export type SubTabsVariant = 'pills' | 'sidebar'

type SubTabsContextValue = { value: string; idPrefix: string }
const SubTabsContext = React.createContext<SubTabsContextValue | null>(null)

const tabId = (prefix: string, key: string) => `${prefix}-tab-${key}`
const panelId = (prefix: string, key: string) => `${prefix}-panel-${key}`

// ---------- URL + memory ----------

// Remembered choices are read through useSyncExternalStore: the server
// snapshot is null, so the first client render matches the server render and
// the stored value shows right after hydration.
const STORE_EVENT = 'lh:subtab-store'

function readStored(key: string | null): string | null {
  if (!key) return null
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStored(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // storage blocked: the URL still carries the choice
  }
  window.dispatchEvent(new Event(STORE_EVENT))
}

function subscribeStored(onChange: () => void) {
  window.addEventListener('storage', onChange)
  window.addEventListener(STORE_EVENT, onChange)
  return () => {
    window.removeEventListener('storage', onChange)
    window.removeEventListener(STORE_EVENT, onChange)
  }
}

export function useSubTab<K extends string>(
  defaultKey: K,
  keys: readonly K[],
  options: {
    // Search param name; change it only if a page has two sub-tab rows.
    param?: string
    // Key for "last choice" memory. Defaults to the pathname; pass something
    // shorter to share the memory across ids (e.g. every course's editor).
    rememberAs?: string | false
  } = {}
): readonly [K, (key: K) => void] {
  const param = options.param ?? SUB_TAB_PARAM
  const pathname = usePathname() ?? ''
  const searchParams = useSearchParams()
  const urlValue = searchParams?.get(param) ?? null
  const storageKey = options.rememberAs === false ? null : subTabStorageKey(options.rememberAs ?? pathname, param)
  const stored = React.useSyncExternalStore(
    subscribeStored,
    () => readStored(storageKey),
    () => null
  )

  // The pick made here, with the URL value it was made on. It wins until the
  // URL moves (our own replaceState catching up, or a deep link /
  // back-forward), after which the URL is the truth again. It also covers
  // routes where useSearchParams does not follow replaceState.
  const [local, setLocal] = React.useState<{ key: string; base: string | null } | null>(null)
  const localKey = local && local.base === urlValue ? local.key : null

  const value = resolveSubTab({ urlValue, local: localKey, stored, defaultKey, keys })

  const setValue = (key: K) => {
    if (!keys.includes(key)) return
    setLocal({ key, base: urlValue })
    if (storageKey) writeStored(storageKey, key)
    const { pathname: path, search, hash } = window.location
    const nextSearch = buildSubTabSearch(search, param, key, defaultKey)
    if (nextSearch !== search) window.history.replaceState(window.history.state, '', `${path}${nextSearch}${hash}`)
  }

  return [value, setValue] as const
}

// ---------- tab row ----------

export function SubTabs<K extends string>({
  items,
  value,
  onChange,
  variant = 'pills',
  ariaLabel,
  idPrefix = 'subtab',
  className = '',
  children,
}: {
  items: SubTabItem<K>[]
  value: K
  onChange: (key: K) => void
  variant?: SubTabsVariant
  ariaLabel?: string
  // Prefix for the tab/panel ids; set it if a page renders two SubTabs.
  idPrefix?: string
  className?: string
  children?: React.ReactNode
}) {
  const { t } = useTranslation()
  const visible = items.filter((item) => !item.hidden)
  const listRef = React.useRef<HTMLDivElement>(null)
  const sidebar = variant === 'sidebar'

  // Keep the active pill in view when the row scrolls sideways (phones).
  // Measured with client rects so it works the same in LTR and RTL, and
  // scrolls only the row, never the page.
  React.useEffect(() => {
    const list = listRef.current
    const active = list?.querySelector<HTMLElement>('[aria-selected="true"]')
    if (!list || !active || list.scrollWidth <= list.clientWidth) return
    const c = list.getBoundingClientRect()
    const a = active.getBoundingClientRect()
    if (a.left < c.left) list.scrollBy({ left: a.left - c.left - 12 })
    else if (a.right > c.right) list.scrollBy({ left: a.right - c.right + 12 })
  }, [value])

  const focusTab = (key: string) => {
    const el = listRef.current?.querySelector<HTMLElement>(`#${CSS.escape(tabId(idPrefix, key))}`)
    el?.focus()
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const enabled = visible.filter((item) => !item.disabled)
    const index = enabled.findIndex((item) => item.key === value)
    if (index < 0 || enabled.length === 0) return
    const rtl = getComputedStyle(e.currentTarget).direction === 'rtl'
    let next = -1
    switch (e.key) {
      case 'ArrowRight':
        next = rtl ? index - 1 : index + 1
        break
      case 'ArrowLeft':
        next = rtl ? index + 1 : index - 1
        break
      case 'ArrowDown':
        next = index + 1
        break
      case 'ArrowUp':
        next = index - 1
        break
      case 'Home':
        next = 0
        break
      case 'End':
        next = enabled.length - 1
        break
      default:
        return
    }
    e.preventDefault()
    const target = enabled[(next + enabled.length) % enabled.length]
    onChange(target.key)
    focusTab(target.key)
  }

  const tabClass = (active: boolean, disabled?: boolean) => {
    const base =
      'group inline-flex items-center gap-2 shrink-0 whitespace-nowrap font-semibold transition-[background-color,color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/20'
    const state = disabled
      ? 'text-neutral-400 opacity-60 cursor-not-allowed'
      : active
        ? 'bg-white text-neutral-900 shadow-[0_1px_2px_rgba(0,0,0,0.08),0_0_0_1px_rgba(0,0,0,0.06)]'
        : 'text-neutral-500 hover:text-neutral-900'
    // Sidebar items are rows from lg up, pills below.
    const shape = sidebar
      ? `h-8 px-3 rounded-lg text-[13px] lg:h-9 lg:w-full lg:rounded-xl lg:text-sm ${active || disabled ? '' : 'lg:hover:bg-neutral-200/50'}`
      : 'h-8 px-3 rounded-lg text-[13px]'
    return `${base} ${shape} ${state}`
  }

  const row = (
    <div
      ref={listRef}
      role="tablist"
      aria-label={ariaLabel}
      aria-orientation={sidebar ? 'vertical' : 'horizontal'}
      onKeyDown={onKeyDown}
      className={
        sidebar
          ? 'flex max-w-full gap-1 overflow-x-auto scrollbar-hide rounded-xl bg-neutral-200/60 p-1 lg:flex-col lg:overflow-visible lg:bg-transparent lg:p-0'
          : 'flex max-w-full w-fit gap-1 overflow-x-auto scrollbar-hide rounded-xl bg-neutral-200/60 p-1'
      }
    >
      {visible.map((item) => {
        const active = item.key === value
        return (
          <button
            key={item.key}
            id={tabId(idPrefix, item.key)}
            type="button"
            role="tab"
            aria-selected={active}
            aria-controls={panelId(idPrefix, item.key)}
            aria-disabled={item.disabled || undefined}
            tabIndex={active ? 0 : -1}
            disabled={item.disabled}
            onClick={() => onChange(item.key)}
            className={tabClass(active, item.disabled)}
          >
            {item.icon && (
              <span
                className={`shrink-0 [&>svg]:size-[15px] ${active ? 'text-neutral-900' : 'text-neutral-400 group-hover:text-neutral-600'}`}
              >
                <TabIcon icon={item.icon} />
              </span>
            )}
            <span className={sidebar ? 'lg:flex-1 lg:text-start lg:truncate' : ''}>{item.label}</span>
            {item.badge}
            {item.dirty && (
              <span
                className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0"
                role="img"
                aria-label={t('dashboard.courses.save.unsaved')}
                title={t('dashboard.courses.save.unsaved')}
              />
            )}
          </button>
        )
      })}
    </div>
  )

  const ctx = React.useMemo(() => ({ value: value as string, idPrefix }), [value, idPrefix])

  // One sub-tab is no choice: show its panel without a row.
  if (visible.length < 2) {
    if (!children) return null
    return (
      <SubTabsContext.Provider value={ctx}>
        <div className={`min-w-0 ${className}`}>{children}</div>
      </SubTabsContext.Provider>
    )
  }

  if (!children) return <div className={`min-w-0 ${className}`}>{row}</div>

  if (sidebar) {
    return (
      <SubTabsContext.Provider value={ctx}>
        <div className={`grid grid-cols-1 gap-5 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-8 ${className}`}>
          <nav className="min-w-0 lg:sticky lg:top-6 lg:self-start">{row}</nav>
          <div className="min-w-0">{children}</div>
        </div>
      </SubTabsContext.Provider>
    )
  }

  return (
    <SubTabsContext.Provider value={ctx}>
      <div className={`min-w-0 ${className}`}>
        {row}
        <div className="mt-5 min-w-0">{children}</div>
      </div>
    </SubTabsContext.Provider>
  )
}

// ---------- panel ----------

export function SubTabPanel({
  tab,
  value,
  idPrefix,
  unmountWhenHidden = false,
  className = 'space-y-5',
  children,
}: {
  tab: string
  // Only needed outside <SubTabs>{children}</SubTabs>.
  value?: string
  idPrefix?: string
  // Drop the panel's DOM (and state) when another sub-tab opens.
  unmountWhenHidden?: boolean
  className?: string
  children: React.ReactNode
}) {
  const ctx = React.useContext(SubTabsContext)
  const active = (value ?? ctx?.value) === tab
  const prefix = idPrefix ?? ctx?.idPrefix ?? 'subtab'
  const [visited, setVisited] = React.useState(active)
  if (active && !visited) setVisited(true)

  if (!active && (unmountWhenHidden || !visited)) return null
  return (
    <div
      role="tabpanel"
      id={panelId(prefix, tab)}
      aria-labelledby={tabId(prefix, tab)}
      hidden={!active}
      tabIndex={-1}
      className={`focus:outline-none ${className}`}
    >
      {children}
    </div>
  )
}
