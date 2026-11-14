import CtaLink from './CtaLink'
import { SIGNUP_URL } from '@/lib/cta'

const VARIANTS = {
  // Self-hosting pages where running your own instance gets in the way.
  selfhost: {
    label: 'Rather not run this yourself?',
    placement: 'selfhost_skip',
    action: 'Start free on LearnHouse Cloud',
  },
  // Developer quickstarts, for readers without an instance yet.
  developer: {
    label: 'No LearnHouse instance yet?',
    placement: 'dev_quickstart',
    action: 'Create a free Cloud organization',
  },
}

/** A quiet call to action that names the reader's situation. `children` is the one-line pitch. */
export function CloudCta({ variant = 'selfhost', children }) {
  const v = VARIANTS[variant] ?? VARIANTS.selfhost
  return (
    <aside className="lh-cloud-cta" data-pagefind-ignore="all">
      <div className="lh-cloud-cta-copy">
        <strong>{v.label}</strong> {children}
      </div>
      <CtaLink href={SIGNUP_URL} placement={v.placement} target="_blank" rel="noopener" className="lh-cloud-cta-button">
        {v.action}
      </CtaLink>
    </aside>
  )
}
