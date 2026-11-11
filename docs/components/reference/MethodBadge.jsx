/**
 * Understated method label: mono text, a small coloured dot per method.
 * `variant="pill"` sits on a light neutral pill (endpoint headers);
 * `variant="bare"` is the compact nav form.
 */
export default function MethodBadge({ method, variant = 'pill' }) {
  const m = String(method || '').toUpperCase()
  return (
    <span className={`lhr-method lhr-method-${variant}`} data-method={m.toLowerCase()}>
      {m === 'DELETE' && variant === 'bare' ? 'DEL' : m}
    </span>
  )
}
