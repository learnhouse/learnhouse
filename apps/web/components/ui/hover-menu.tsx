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

interface HoverMenuContextValue {
  menuRef: React.RefObject<HTMLDivElement | null>
  closeMenu: () => void
  focusFirstItem: () => void
  focusAdjacentItem: (currentItem: HTMLDivElement, direction: "next" | "previous") => void
}

const HoverMenuContext = React.createContext<HoverMenuContextValue | null>(null)

const HoverMenu = React.forwardRef<HTMLDivElement, HoverMenuProps>(
  ({ children, content, contentClassName, align = "start" }, ref) => {
    const triggerRef = React.useRef<HTMLDivElement>(null)
    const menuRef = React.useRef<HTMLDivElement>(null)
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

    const closeMenu = React.useCallback(() => {
      setIsHovered(false)
      triggerRef.current?.focus()
    }, [])

    const getMenuItems = React.useCallback(() => {
      if (!menuRef.current) {
        return []
      }

      return Array.from(
        menuRef.current.querySelectorAll<HTMLDivElement>('[role="menuitem"]')
      )
    }, [])

    const focusFirstItem = React.useCallback(() => {
      getMenuItems()[0]?.focus()
    }, [getMenuItems])

    const focusAdjacentItem = React.useCallback(
      (currentItem: HTMLDivElement, direction: "next" | "previous") => {
        const items = getMenuItems()
        const currentIndex = items.indexOf(currentItem)

        if (currentIndex === -1 || items.length === 0) {
          return
        }

        const nextIndex =
          direction === "next"
            ? (currentIndex + 1) % items.length
            : (currentIndex - 1 + items.length) % items.length

        items[nextIndex]?.focus()
      },
      [getMenuItems]
    )

    React.useEffect(() => {
      if (!isHovered) {
        return
      }

      const frameId = window.requestAnimationFrame(() => {
        focusFirstItem()
      })

      return () => {
        window.cancelAnimationFrame(frameId)
      }
    }, [focusFirstItem, isHovered])

    React.useEffect(() => {
      return () => {
        if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current)
        if (leaveTimeoutRef.current) clearTimeout(leaveTimeoutRef.current)
      }
    }, [])

    // Don't render portal until we have a position
    const shouldRenderPortal = position !== null

    return (
      <HoverMenuContext.Provider
        value={{
          menuRef,
          closeMenu,
          focusFirstItem,
          focusAdjacentItem,
        }}
      >
        <div
          ref={triggerRef}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          tabIndex={-1}
          aria-expanded={isHovered}
          aria-haspopup="menu"
        >
          {children}
        </div>
        {shouldRenderPortal && (
          <Portal.Root>
            <div
              ref={ref}
              onMouseEnter={handleMouseEnter}
              onMouseLeave={handleMouseLeave}
              style={{
                position: 'fixed',
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
      </HoverMenuContext.Provider>
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
    const context = React.useContext(HoverMenuContext)

    return (
      <div
        ref={(node) => {
          if (context) {
            context.menuRef.current = node
          }

          if (typeof ref === "function") {
            ref(node)
          } else if (ref) {
            ref.current = node
          }
        }}
        role="menu"
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
    const context = React.useContext(HoverMenuContext)

    const handleKeyDown = React.useCallback(
      (event: React.KeyboardEvent<HTMLDivElement>) => {
        switch (event.key) {
          case "Enter":
          case " ":
            event.preventDefault()
            event.currentTarget.click()
            break
          case "ArrowDown":
            event.preventDefault()
            context?.focusAdjacentItem(event.currentTarget, "next")
            break
          case "ArrowUp":
            event.preventDefault()
            context?.focusAdjacentItem(event.currentTarget, "previous")
            break
          case "Escape":
            event.preventDefault()
            context?.closeMenu()
            break
          default:
            break
        }
      },
      [context]
    )

    if (asChild) {
      return (
        <div
          ref={ref}
          role="menuitem"
          tabIndex={0}
          onClick={onClick}
          onKeyDown={handleKeyDown}
          className={cn("hover-menu-item", className)}
        >
          {children}
        </div>
      )
    }

    return (
      <div
        ref={ref}
        role="menuitem"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={handleKeyDown}
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
