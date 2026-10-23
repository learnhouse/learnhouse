"use client"

import * as React from "react"
import { useTranslation } from "react-i18next"
import { Input } from "@/components/ui/input"
import { PersianDatePicker } from "@/components/ui/persian-date-picker"
import { baseCode } from "@/lib/direction"

export interface DateInputProps {
  /** Gregorian ISO date, "YYYY-MM-DD". Empty string means "no date". */
  value?: string
  /** Called with a Gregorian ISO "YYYY-MM-DD", or "" when cleared. */
  onChange: (value: string) => void
  className?: string
  placeholder?: string
  disabled?: boolean
  id?: string
  name?: string
  /** Hide the Persian picker's inline clear affordances. */
  disableClear?: boolean
}

/**
 * Date field that localises its calendar. Persian (fa) gets the Jalali / Hijri
 * Shamsi picker; every other language keeps the browser's native date input.
 *
 * Both branches speak the same wire format - a Gregorian ISO "YYYY-MM-DD"
 * string - so this is a drop-in for the `<input type="date">` sites that
 * already store that value, and the stored data never changes with the UI
 * language. See lib/jalali.ts for why the value stays Gregorian.
 */
export function DateInput({
  value,
  onChange,
  className,
  placeholder,
  disabled,
  id,
  name,
  disableClear,
}: DateInputProps) {
  const { i18n } = useTranslation()
  const isPersian = baseCode(i18n.language) === "fa"

  if (isPersian) {
    return (
      <PersianDatePicker
        value={value}
        onChange={onChange}
        className={className}
        placeholder={placeholder}
        disabled={disabled}
        disableClear={disableClear}
        id={id}
        name={name}
      />
    )
  }

  return (
    <Input
      type="date"
      id={id}
      name={name}
      value={value ?? ""}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className={className}
    />
  )
}
