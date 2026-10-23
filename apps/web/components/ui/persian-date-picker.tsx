"use client"

import * as React from "react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { CalendarBlank, CaretLeft, CaretRight, X } from "@phosphor-icons/react"
import { useTranslation } from "react-i18next"
import {
  JALALI_MONTHS,
  JALALI_WEEKDAYS_SHORT,
  formatJalaliLabel,
  gregorianToJalali,
  jalaliMonthLength,
  jalaliToGregorian,
  jalaliWeekColumn,
  parseGregorianISO,
  toGregorianISO,
  toPersianDigits,
} from "@/lib/jalali"

export interface PersianDatePickerProps {
  /** Gregorian ISO date, "YYYY-MM-DD". Empty string means "no date". */
  value?: string
  /** Called with a Gregorian ISO "YYYY-MM-DD", or "" when cleared. */
  onChange: (value: string) => void
  className?: string
  placeholder?: string
  disabled?: boolean
  /** Hide the inline clear button even when a value is set. */
  disableClear?: boolean
  id?: string
  name?: string
}

/**
 * A Jalali (Hijri Shamsi) calendar that reads and writes Gregorian ISO strings,
 * so it drops straight into anywhere `<input type="date">` is used today. The
 * calendar grid, month names and digits are Persian; the stored value stays
 * Gregorian and Latin-digit, matching the rest of the date layer.
 */
export function PersianDatePicker({
  value,
  onChange,
  className,
  placeholder,
  disabled,
  disableClear,
  id,
  name,
}: PersianDatePickerProps) {
  const { t } = useTranslation()
  const [open, setOpen] = React.useState(false)

  const selected = React.useMemo(() => {
    const g = parseGregorianISO(value)
    return g ? gregorianToJalali(g.gy, g.gm, g.gd) : null
  }, [value])

  // The month the grid is currently showing. Defaults to the selected date, or
  // to today when nothing is selected.
  const [view, setView] = React.useState(() => {
    if (selected) return { jy: selected.jy, jm: selected.jm }
    const now = new Date()
    const jNow = gregorianToJalali(
      now.getFullYear(),
      now.getMonth() + 1,
      now.getDate()
    )
    return { jy: jNow.jy, jm: jNow.jm }
  })

  // Opening the popover jumps the grid to the selected month, so reopening
  // after a change never leaves the view stranded on an old month. Done in the
  // open handler (an event) rather than an effect to avoid a cascading render.
  const handleOpenChange = (next: boolean) => {
    if (next && selected) setView({ jy: selected.jy, jm: selected.jm })
    setOpen(next)
  }

  const today = React.useMemo(() => {
    const now = new Date()
    return gregorianToJalali(now.getFullYear(), now.getMonth() + 1, now.getDate())
  }, [])

  const goMonth = (delta: number) => {
    setView((v) => {
      let jm = v.jm + delta
      let jy = v.jy
      if (jm < 1) {
        jm = 12
        jy -= 1
      } else if (jm > 12) {
        jm = 1
        jy += 1
      }
      return { jy, jm }
    })
  }

  const days = React.useMemo(() => {
    const length = jalaliMonthLength(view.jy, view.jm)
    const firstG = jalaliToGregorian(view.jy, view.jm, 1)
    const leading = jalaliWeekColumn(firstG.gy, firstG.gm, firstG.gd)
    const cells: Array<number | null> = Array.from({ length: leading }, () => null)
    for (let d = 1; d <= length; d += 1) cells.push(d)
    return cells
  }, [view])

  const handlePick = (jd: number) => {
    const g = jalaliToGregorian(view.jy, view.jm, jd)
    onChange(toGregorianISO(g))
    setOpen(false)
  }

  const label = formatJalaliLabel(value)
  const showClear = !disableClear && !disabled && !!value

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          id={id}
          name={name}
          dir="rtl"
          disabled={disabled}
          className={cn(
            "flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
            className
          )}
        >
          <span className="flex items-center gap-2 truncate">
            <CalendarBlank size={16} className="shrink-0 text-gray-400" />
            <span className={cn("truncate", !label && "text-muted-foreground")}>
              {label || placeholder || t("datepicker.placeholder", { defaultValue: "انتخاب تاریخ" })}
            </span>
          </span>
          {showClear && (
            <span
              role="button"
              tabIndex={-1}
              aria-label={t("datepicker.clear", { defaultValue: "پاک کردن" })}
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                onChange("")
              }}
              className="shrink-0 rounded p-0.5 text-gray-400 transition-colors hover:text-gray-700"
            >
              <X size={14} />
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent dir="rtl" align="start" className="w-[17rem] p-3">
        {/* Month navigation. The container is dir="rtl", so the first button
            below renders on the RIGHT and the second on the LEFT. In the Jalali
            calendar time runs right-to-left: the right-hand control steps to the
            PREVIOUS month (caret pointing right), the left-hand control to the
            NEXT month (caret pointing left), so each arrow points the way it
            moves. */}
        <div className="mb-2 flex items-center justify-between">
          <button
            type="button"
            onClick={() => goMonth(-1)}
            aria-label={t("datepicker.prev_month", { defaultValue: "ماه قبل" })}
            className="rounded-md p-1 text-gray-500 transition-colors hover:bg-accent hover:text-gray-900"
          >
            <CaretRight size={16} />
          </button>
          <div className="text-sm font-semibold text-gray-800">
            {JALALI_MONTHS[view.jm - 1]} {toPersianDigits(view.jy)}
          </div>
          <button
            type="button"
            onClick={() => goMonth(1)}
            aria-label={t("datepicker.next_month", { defaultValue: "ماه بعد" })}
            className="rounded-md p-1 text-gray-500 transition-colors hover:bg-accent hover:text-gray-900"
          >
            <CaretLeft size={16} />
          </button>
        </div>

        <div className="mb-1 grid grid-cols-7 gap-0.5">
          {JALALI_WEEKDAYS_SHORT.map((w, i) => (
            <div
              key={i}
              className="flex h-7 items-center justify-center text-[11px] font-medium text-gray-400"
            >
              {w}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-0.5">
          {days.map((d, i) => {
            if (d === null) return <div key={`e-${i}`} className="h-8" />
            const isSelected =
              selected &&
              selected.jy === view.jy &&
              selected.jm === view.jm &&
              selected.jd === d
            const isToday =
              today.jy === view.jy && today.jm === view.jm && today.jd === d
            return (
              <button
                key={d}
                type="button"
                onClick={() => handlePick(d)}
                className={cn(
                  "flex h-8 items-center justify-center rounded-md text-sm transition-colors",
                  isSelected
                    ? "bg-primary text-primary-foreground hover:bg-primary/90"
                    : "text-gray-700 hover:bg-accent",
                  !isSelected && isToday && "border border-primary/40 font-semibold"
                )}
              >
                {toPersianDigits(d)}
              </button>
            )
          })}
        </div>

        <div className="mt-2 flex items-center justify-between border-t border-gray-100 pt-2">
          <button
            type="button"
            onClick={() => {
              const now = new Date()
              onChange(
                toGregorianISO({
                  gy: now.getFullYear(),
                  gm: now.getMonth() + 1,
                  gd: now.getDate(),
                })
              )
              setOpen(false)
            }}
            className="text-xs font-medium text-primary hover:underline"
          >
            {t("datepicker.today", { defaultValue: "امروز" })}
          </button>
          {!disableClear && value && (
            <button
              type="button"
              onClick={() => {
                onChange("")
                setOpen(false)
              }}
              className="text-xs font-medium text-gray-400 transition-colors hover:text-gray-700"
            >
              {t("datepicker.clear", { defaultValue: "پاک کردن" })}
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
