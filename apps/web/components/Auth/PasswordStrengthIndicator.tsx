'use client'
import React from 'react'
import { Check, Circle } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface PasswordRule {
    id: string
    /** i18n key for the checklist label. */
    labelKey: string
    /** English message returned by validatePasswordStrength. */
    error: string
    test: (_password: string) => boolean
}

// The passwords people reach for first. Mirrors COMMON_PASSWORDS in the API's
// password_validation.py, which is the real check.
export const COMMON_PASSWORDS = new Set([
    'password1', 'password12', 'password123', 'passw0rd', 'p@ssw0rd', 'p@ssword1',
    'qwerty123', 'qwerty12', 'qwertyuiop1', '1q2w3e4r', '1qaz2wsx', 'zaq12wsx', 'q1w2e3r4',
    'abc12345', 'abcd1234', 'abcdef12', 'test1234', 'letmein1', 'welcome1', 'welcome123',
    'iloveyou1', 'admin123', 'admin1234', 'administrator1', 'changeme1', '12345678a', 'a12345678',
    'football1', 'baseball1', 'monkey123', 'dragon123', 'sunshine1', 'princess1', 'trustno1',
    'master123', 'shadow123', 'superman1', 'computer1', 'learnhouse1',
])

// Mirrors the API's password policy (password_validation.py): long enough,
// not all one kind of character, and not one of the usual suspects.
const PASSWORD_RULES: PasswordRule[] = [
    {
        id: 'minLength',
        labelKey: 'auth.password_req_min_length',
        error: 'Password must be at least 8 characters',
        test: (pwd) => pwd.length >= 8,
    },
    {
        id: 'letter',
        labelKey: 'auth.password_req_letter',
        error: 'Password must contain at least one letter',
        test: (pwd) => /\p{L}/u.test(pwd),
    },
    {
        id: 'numberOrSymbol',
        labelKey: 'auth.password_req_number_or_symbol',
        error: 'Password must contain at least one number or symbol',
        test: (pwd) => /[^\p{L}\s]/u.test(pwd),
    },
    {
        id: 'notCommon',
        labelKey: 'auth.password_req_not_common',
        error: 'This password is too common',
        test: (pwd) => pwd.length > 0 && !COMMON_PASSWORDS.has(pwd.toLowerCase()),
    },
]

interface PasswordStrengthIndicatorProps {
    password: string
    showRequirements?: boolean
}

/** The password rules as a quiet inline checklist that ticks as you type. */
export function PasswordStrengthIndicator({
    password,
    showRequirements = true,
}: PasswordStrengthIndicatorProps) {
    const { t } = useTranslation()

    if (!password || !showRequirements) {
        return null
    }

    // Labels are translated during render rather than memoized on `t`, so they
    // always follow the active language, including when its bundle loads late.
    return (
        <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs" data-testid="password-rules">
            {PASSWORD_RULES.map((rule) => {
                const isValid = rule.test(password)
                return (
                    <li
                        key={rule.id}
                        className={`flex items-center gap-1 ${
                            isValid ? 'text-emerald-600' : 'text-neutral-500'
                        }`}
                    >
                        {isValid ? (
                            <Check className="h-3.5 w-3.5" aria-hidden="true" />
                        ) : (
                            <Circle className="h-2.5 w-2.5 mx-0.5" aria-hidden="true" />
                        )}
                        <span>{t(rule.labelKey)}</span>
                    </li>
                )
            })}
        </ul>
    )
}

export function validatePasswordStrength(password: string): {
    isValid: boolean
    errors: string[]
} {
    const errors = PASSWORD_RULES.filter((rule) => !rule.test(password)).map((rule) => rule.error)
    return {
        isValid: errors.length === 0,
        errors,
    }
}

export default PasswordStrengthIndicator
