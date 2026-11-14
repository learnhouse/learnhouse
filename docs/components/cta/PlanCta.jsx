import { ArrowRight } from '@phosphor-icons/react/dist/ssr'
import CtaLink from './CtaLink'
import { PRICING_URL, SIGNUP_URL } from '@/lib/cta'

/**
 * Goes inside a plan callout ("needs the Pro plan on LearnHouse Cloud"): a way
 * to try the feature right there. Enterprise features point at the plans page.
 */
export function PlanCta({ plan }) {
  const term = plan?.toLowerCase()
  if (plan === 'Enterprise') {
    return (
      <span className="lh-plan-cta">
        <CtaLink href={PRICING_URL} placement="plan_callout" term={term} target="_blank" rel="noopener" className="lh-plan-cta-primary">
          See the Enterprise plan <ArrowRight size={12} weight="bold" />
        </CtaLink>
      </span>
    )
  }
  return (
    <span className="lh-plan-cta">
      <CtaLink href={SIGNUP_URL} placement="plan_callout" term={term} target="_blank" rel="noopener" className="lh-plan-cta-primary">
        Start free on LearnHouse Cloud <ArrowRight size={12} weight="bold" />
      </CtaLink>
      <CtaLink href={PRICING_URL} placement="plan_callout_pricing" term={term} target="_blank" rel="noopener" className="lh-plan-cta-secondary">
        Compare plans
      </CtaLink>
    </span>
  )
}
