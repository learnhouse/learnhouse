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
          left: rect.right + 8, // 8px gap (ms-2)
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
              <div className="absolute -start-2 top-0 bottom-0 w-2" />
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
