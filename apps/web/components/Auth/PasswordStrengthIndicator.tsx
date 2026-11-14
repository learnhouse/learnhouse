'use client'
import React from 'react'
import { Check, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface PasswordRule {
    id: string
    /** i18n key for the checklist label. */
    labelKey: string
    /** English message returned by validatePasswordStrength. */
    error: string
    test: (password: string) => boolean
}

// Mirrors the API's password policy (password_validation.py).
const PASSWORD_RULES: PasswordRule[] = [
    {
        id: 'minLength',
        labelKey: 'auth.password_req_min_length',
        error: 'Password must be at least 8 characters',
        test: (pwd) => pwd.length >= 8,
    },
    {
        id: 'uppercase',
        labelKey: 'auth.password_req_uppercase',
        error: 'Password must contain at least one uppercase letter',
        test: (pwd) => /[A-Z]/.test(pwd),
    },
    {
        id: 'lowercase',
        labelKey: 'auth.password_req_lowercase',
        error: 'Password must contain at least one lowercase letter',
        test: (pwd) => /[a-z]/.test(pwd),
    },
    {
        id: 'number',
        labelKey: 'auth.password_req_number',
        error: 'Password must contain at least one number',
        test: (pwd) => /[0-9]/.test(pwd),
    },
    {
        id: 'special',
        labelKey: 'auth.password_req_special',
        error: 'Password must contain at least one special character',
        test: (pwd) => /[!@#$%^&*()_+\-=\[\]{}|;':",./<>?]/.test(pwd),
    },
]

interface PasswordStrengthIndicatorProps {
    password: string
    showRequirements?: boolean
}

export function PasswordStrengthIndicator({
    password,
    showRequirements = true,
}: PasswordStrengthIndicatorProps) {
    const { t } = useTranslation()

    // Labels are translated during render rather than memoized on `t`, so they
    // always follow the active language, including when its bundle loads late.
    const validCount = PASSWORD_RULES.filter((rule) => rule.test(password)).length
    const strengthPercentage = (validCount / PASSWORD_RULES.length) * 100

    const getStrengthColor = () => {
        if (strengthPercentage === 0) return 'bg-gray-200'
        if (strengthPercentage <= 40) return 'bg-red-500'
        if (strengthPercentage <= 60) return 'bg-orange-500'
        if (strengthPercentage <= 80) return 'bg-yellow-500'
        return 'bg-green-500'
    }

    const getStrengthLabel = () => {
        if (strengthPercentage === 0) return ''
        if (strengthPercentage <= 40) return t('auth.password_strength_weak')
        if (strengthPercentage <= 60) return t('auth.password_strength_fair')
        if (strengthPercentage <= 80) return t('auth.password_strength_good')
        return t('auth.password_strength_strong')
    }

    // Don't show anything if password is empty
    if (!password) {
        return null
    }

    return (
        <div className="mt-2 space-y-2">
            {/* Strength bar */}
            <div className="space-y-1">
                <div className="flex justify-between text-xs">
                    <span className="text-gray-500">{t('auth.password_strength')}</span>
                    <span className={`font-medium ${
                        strengthPercentage <= 40 ? 'text-red-600' :
                        strengthPercentage <= 60 ? 'text-orange-600' :
                        strengthPercentage <= 80 ? 'text-yellow-600' :
                        'text-green-600'
                    }`}>
                        {getStrengthLabel()}
                    </span>
                </div>
                <div className="h-1.5 w-full bg-gray-200 rounded-full overflow-hidden">
                    <div
                        className={`h-full transition-all duration-300 ${getStrengthColor()}`}
                        style={{ width: `${strengthPercentage}%` }}
                    />
                </div>
            </div>

            {/* Requirements list */}
            {showRequirements && (
                <ul className="text-xs space-y-1">
                    {PASSWORD_RULES.map((rule) => {
                        const isValid = rule.test(password)
                        return (
                            <li
                                key={rule.id}
                                className={`flex items-center gap-1.5 ${
                                    isValid ? 'text-green-600' : 'text-gray-500'
                                }`}
                            >
                                {isValid ? (
                                    <Check className="h-3.5 w-3.5" />
                                ) : (
                                    <X className="h-3.5 w-3.5" />
                                )}
                                <span>{t(rule.labelKey)}</span>
                            </li>
                        )
                    })}
                </ul>
            )}
        </div>
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
