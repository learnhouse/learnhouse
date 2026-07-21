export default function MethodBadge({ method, small = false }) {
  const m = String(method || '').toUpperCase()
  return (
    <span className={`lh-ref-method lh-ref-method-${m.toLowerCase()} ${small ? 'lh-ref-method-sm' : ''}`}>
      {m}
    </span>
  )
}
