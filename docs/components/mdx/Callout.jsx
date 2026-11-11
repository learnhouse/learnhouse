import { Info, Warning, WarningOctagon, Lightbulb, CheckCircle } from '@phosphor-icons/react/dist/ssr'

const TYPES = {
  default: { icon: Lightbulb, className: 'lh-callout-default' },
  info: { icon: Info, className: 'lh-callout-info' },
  warning: { icon: Warning, className: 'lh-callout-warning' },
  error: { icon: WarningOctagon, className: 'lh-callout-error' },
  important: { icon: Info, className: 'lh-callout-info' },
  success: { icon: CheckCircle, className: 'lh-callout-success' },
}

/** A note set off from the text. `type`: default, info, warning, error, success. */
export function Callout({ type = 'default', children }) {
  const { icon: Icon, className } = TYPES[type] ?? TYPES.default
  return (
    <div className={`lh-callout ${className}`} role={type === 'warning' || type === 'error' ? 'alert' : 'note'}>
      <Icon className="lh-callout-icon" size={17} weight="bold" aria-hidden />
      <div className="lh-callout-body">{children}</div>
    </div>
  )
}
