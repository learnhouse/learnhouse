"use client"

import * as React from "react"
import * as Portal from "@radix-ui/react-portal"
import { cn } from "@/lib/utils"

interface HoverMenuProps {
  children: React.ReactNode
  content: React.ReactNode
  contentClassName?: string
  align?: "start" | "center" | "end"
}

const HoverMenu = React.forwardRef<HTMLDivElement, HoverMenuProps>(
  ({ children, content, contentClassName, align = "start" }, ref) => {
    const triggerRef = React.useRef<HTMLDivElement>(null)
    const menuRef = React.useRef<HTMLDivElement>(null)
    const suppressFocusOpenRef = React.useRef(false)
    const [isHovered, setIsHovered] = React.useState(false)
    const [position, setPosition] = React.useState<{ top: number; left: number } | null>(null)
    const hoverTimeoutRef = React.useRef<NodeJS.Timeout | null>(null)
    const leaveTimeoutRef = React.useRef<NodeJS.Timeout | null>(null)

    const updatePosition = React.useCallback(() => {
      if (triggerRef.current) {
        const rect = triggerRef.current.getBoundingClientRect()
        let top = rect.top

        if (align === "end") {
          top = rect.bottom
        } else if (align === "center") {
          top = rect.top + rect.height / 2
        }

        setPosition({
          top,
          left: rect.right + 8, // 8px gap (ml-2)
        })
      }
    }, [align])

    const setMenuRefs = React.useCallback(
      (node: HTMLDivElement | null) => {
        menuRef.current = node

        if (typeof ref === "function") {
          ref(node)
          return
        }

        if (ref) {
          ref.current = node
        }
      },
      [ref]
    )

    const getMenuItems = React.useCallback(() => {
      if (!menuRef.current) {
        return []
      }

      return Array.from(menuRef.current.querySelectorAll<HTMLElement>("[role=\"menuitem\"]"))
    }, [])

    const focusMenuItemAtIndex = React.useCallback(
      (index: number) => {
        const items = getMenuItems()

        if (!items.length) {
          return
        }

        const normalizedIndex = ((index % items.length) + items.length) % items.length
        items[normalizedIndex]?.focus()
      },
      [getMenuItems]
    )

    const openMenu = React.useCallback(() => {
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current)
        hoverTimeoutRef.current = null
      }

      if (leaveTimeoutRef.current) {
        clearTimeout(leaveTimeoutRef.current)
        leaveTimeoutRef.current = null
      }

      updatePosition()
      setIsHovered(true)
    }, [updatePosition])

    const closeMenu = React.useCallback(() => {
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current)
        hoverTimeoutRef.current = null
      }

      if (leaveTimeoutRef.current) {
        clearTimeout(leaveTimeoutRef.current)
        leaveTimeoutRef.current = null
      }

      setIsHovered(false)
    }, [])

    const openMenuAndFocusItem = React.useCallback(
      (index: number) => {
        openMenu()
        window.setTimeout(() => {
          focusMenuItemAtIndex(index)
        }, 0)
      },
      [focusMenuItemAtIndex, openMenu]
    )

    const handleMouseEnter = React.useCallback(() => {
      if (leaveTimeoutRef.current) {
        clearTimeout(leaveTimeoutRef.current)
        leaveTimeoutRef.current = null
      }
      // Update position immediately, then show after a brief delay
      updatePosition()
      hoverTimeoutRef.current = setTimeout(() => {
        setIsHovered(true)
      }, 50)
    }, [updatePosition])

    const handleMouseLeave = React.useCallback(() => {
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current)
        hoverTimeoutRef.current = null
      }
      leaveTimeoutRef.current = setTimeout(() => {
        setIsHovered(false)
      }, 100)
    }, [])

    const handleTriggerBlur = React.useCallback(
      (event: React.FocusEvent<HTMLDivElement>) => {
        const nextFocusedElement = event.relatedTarget

        if (nextFocusedElement && menuRef.current?.contains(nextFocusedElement as Node)) {
          return
        }

        handleMouseLeave()
      },
      [handleMouseLeave]
    )

    const handleTriggerFocus = React.useCallback(() => {
      if (suppressFocusOpenRef.current) {
        suppressFocusOpenRef.current = false
        return
      }

      handleMouseEnter()
    }, [handleMouseEnter])

    const handleTriggerKeyDown = React.useCallback(
      (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key === "Enter" || event.key === " " || event.key === "ArrowDown") {
          event.preventDefault()
          openMenuAndFocusItem(0)
          return
        }

        if (event.key === "Escape" && isHovered) {
          event.preventDefault()
          closeMenu()
        }
      },
      [closeMenu, isHovered, openMenuAndFocusItem]
    )

    const handleMenuKeyDown = React.useCallback(
      (event: React.KeyboardEvent<HTMLDivElement>) => {
        const items = getMenuItems()
        const currentIndex = items.findIndex((item) => item === document.activeElement)

        if (event.key === "ArrowDown") {
          event.preventDefault()
          focusMenuItemAtIndex(currentIndex === -1 ? 0 : currentIndex + 1)
          return
        }

        if (event.key === "ArrowUp") {
          event.preventDefault()
          focusMenuItemAtIndex(currentIndex === -1 ? items.length - 1 : currentIndex - 1)
          return
        }

        if (event.key === "Home") {
          event.preventDefault()
          focusMenuItemAtIndex(0)
          return
        }

        if (event.key === "End") {
          event.preventDefault()
          focusMenuItemAtIndex(items.length - 1)
          return
        }

        if (event.key === "Escape") {
          event.preventDefault()
          closeMenu()
          suppressFocusOpenRef.current = true
          triggerRef.current?.focus()
          return
        }

        if (event.key === "Tab") {
          closeMenu()
        }
      },
      [closeMenu, focusMenuItemAtIndex, getMenuItems]
    )

    React.useEffect(() => {
      return () => {
        if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current)
        if (leaveTimeoutRef.current) clearTimeout(leaveTimeoutRef.current)
      }
    }, [])

    // Don't render portal until we have a position
    const shouldRenderPortal = position !== null

    return (
      <>
        <div
          ref={triggerRef}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          onFocus={handleTriggerFocus}
          onBlur={handleTriggerBlur}
          onKeyDown={handleTriggerKeyDown}
          tabIndex={0}
          role="button"
          aria-haspopup="menu"
          aria-expanded={isHovered}
        >
          {children}
        </div>
        {shouldRenderPortal && (
          <Portal.Root>
            <div
              ref={setMenuRefs}
              onMouseEnter={handleMouseEnter}
              onMouseLeave={handleMouseLeave}
              onKeyDown={handleMenuKeyDown}
              role="menu"
              style={{
                position: "fixed",
                top: position.top,
                left: position.left,
                transform: align === "end" ? "translateY(-100%)" : align === "center" ? "translateY(-50%)" : undefined,
              }}
              className={cn(
                "z-modal-backdrop pointer-events-none transition-opacity duration-150",
                isHovered ? "opacity-100 pointer-events-auto" : "opacity-0",
                contentClassName
              )}
            >
              {/* Invisible bridge to prevent gap issues */}
              <div className="absolute -left-2 top-0 bottom-0 w-2" />
              {content}
            </div>
          </Portal.Root>
        )}
      </>
    )
  }
)
HoverMenu.displayName = "HoverMenu"

interface HoverMenuContentProps {
  children: React.ReactNode
  className?: string
}

const HoverMenuContent = React.forwardRef<HTMLDivElement, HoverMenuContentProps>(
  ({ children, className }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          "min-w-[200px] rounded-lg border bg-[#0f0f10] border-white/10 shadow-xl shadow-black/30 py-1",
          className
        )}
      >
        {children}
      </div>
    )
  }
)
HoverMenuContent.displayName = "HoverMenuContent"

interface HoverMenuItemProps {
  children: React.ReactNode
  className?: string
  onClick?: () => void
  asChild?: boolean
}

const HoverMenuItem = React.forwardRef<HTMLDivElement, HoverMenuItemProps>(
  ({ children, className, onClick, asChild }, ref) => {
    if (asChild) {
      return (
        <div ref={ref} className={cn("hover-menu-item", className)}>
          {children}
        </div>
      )
    }

    return (
      <div
        ref={ref}
        onClick={onClick}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault()
            onClick?.()
          }
        }}
        role="menuitem"
        tabIndex={-1}
        className={cn(
          "px-3 py-2 text-sm text-white/70 hover:text-white hover:bg-white/[0.08] cursor-pointer transition-colors",
          className
        )}
      >
        {children}
      </div>
    )
  }
)
HoverMenuItem.displayName = "HoverMenuItem"

interface HoverMenuLabelProps {
  children: React.ReactNode
  className?: string
}

const HoverMenuLabel = React.forwardRef<HTMLDivElement, HoverMenuLabelProps>(
  ({ children, className }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          "px-3 py-2 text-xs font-medium text-white/50",
          className
        )}
      >
        {children}
      </div>
    )
  }
)
HoverMenuLabel.displayName = "HoverMenuLabel"

const HoverMenuSeparator = React.forwardRef<HTMLDivElement, { className?: string }>(
  ({ className }, ref) => {
    return (
      <div
        ref={ref}
        className={cn("my-1 h-px bg-white/10", className)}
      />
    )
  }
)
HoverMenuSeparator.displayName = "HoverMenuSeparator"

export {
  HoverMenu,
  HoverMenuContent,
  HoverMenuItem,
  HoverMenuLabel,
  HoverMenuSeparator,
}
