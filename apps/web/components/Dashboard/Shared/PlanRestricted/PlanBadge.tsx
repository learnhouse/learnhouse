'use client'

import React from 'react'
import { PlanLevel, planMeetsRequirement } from '@services/plans/plans'

type BadgeSize = 'sm' | 'md' | 'lg'

interface PlanBadgeProps {
  /** The organization's current plan level */
  currentPlan: PlanLevel
  /** The minimum required plan for the feature */
  requiredPlan: PlanLevel
  /** Size of the badge - sm (default), md, or lg */
  size?: BadgeSize
  /** Always show the badge regardless of plan requirement */
  alwaysShow?: boolean
  /** Remove left margin */
  noMargin?: boolean
}

/**
 * Get plan-specific styling classes
 */
const getPlanStyles = (plan: PlanLevel): string => {
  switch (plan) {
    case 'standard':
      return 'bg-gradient-to-br from-blue-100 to-blue-200 text-blue-800 border-blue-200 shadow-sm shadow-blue-200/50'
    case 'pro':
      return 'bg-gradient-to-br from-purple-100 to-purple-200 text-purple-800 border-purple-200 shadow-sm shadow-purple-200/50'
    case 'enterprise':
      return 'bg-gradient-to-br from-amber-100 to-amber-200 text-amber-800 border-amber-200 shadow-sm shadow-amber-200/50'
    default:
      return 'bg-gradient-to-br from-gray-100 to-gray-200 text-gray-700 border-gray-200 shadow-sm shadow-gray-200/50'
  }
}

/**
 * Get size-specific styling classes
 */
const getSizeStyles = (size: BadgeSize): string => {
  switch (size) {
    case 'sm':
      return 'px-1.5 py-0.5 text-[10px]'
    case 'md':
      return 'px-2 py-1 text-xs'
    case 'lg':
      return 'px-2.5 py-1 text-sm'
    default:
      return 'px-1.5 py-0.5 text-[10px]'
  }
}

/**
 * A small badge that displays when a feature requires a higher plan.
 * Shows nothing if the user has the required plan or higher (unless alwaysShow is true).
 */
const PlanBadge: React.FC<PlanBadgeProps> = ({
  currentPlan,
  requiredPlan,
  size = 'sm',
  alwaysShow = false,
  noMargin = false
}) => {
  // Don't show badge if user meets the requirement (unless alwaysShow)
  if (!alwaysShow && planMeetsRequirement(currentPlan, requiredPlan)) {
    return null
  }

  const capitalizedPlan = requiredPlan.charAt(0).toUpperCase() + requiredPlan.slice(1)
  const planStyles = getPlanStyles(requiredPlan)
  const sizeStyles = getSizeStyles(size)
  const marginClass = noMargin ? '' : 'ml-1.5'

  return (
    <span className={`${marginClass} ${sizeStyles} font-semibold rounded-md border ${planStyles}`}>
      {capitalizedPlan}
    </span>
  )
}

export default PlanBadge
