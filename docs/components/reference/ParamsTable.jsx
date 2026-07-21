import SchemaFields from './SchemaFields'

export default function ParamsTable({ title, rows }) {
  if (!rows?.length) return null
  return (
    <section className="lh-ref-section">
      <h3 className="lh-ref-section-title">{title}</h3>
      <SchemaFields fields={rows} />
    </section>
  )
}
