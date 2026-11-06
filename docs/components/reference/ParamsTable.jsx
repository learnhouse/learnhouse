/**
 * Parameter table (path or query): name, type, required/optional and the
 * description with default/enum/constraints. Collapses to stacked rows on
 * narrow screens (CSS only).
 */
export default function ParamsTable({ title, rows }) {
  if (!rows?.length) return null
  const required = rows.filter((r) => r.required).length
  return (
    <section className="lhr-section">
      <h3 className="lhr-section-title">
        {title}
        <span className="lhr-section-count">
          {required ? `${required} required` : 'all optional'}
        </span>
      </h3>
      <table className="lhr-params">
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Type</th>
            <th scope="col">Description</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.name}>
              <td className="lhr-params-name">
                <code>{p.name}</code>
                {p.required ? (
                  <span className="lhr-field-req">Required</span>
                ) : (
                  <span className="lhr-field-opt">Optional</span>
                )}
              </td>
              <td className="lhr-params-type">
                <code>{p.type || 'any'}</code>
              </td>
              <td className="lhr-params-desc">
                {p.description ? <p>{p.description}</p> : !p.defaultValue && !p.enumValues && <p className="lhr-faint">No description.</p>}
                {(p.defaultValue || p.enumValues?.length || p.constraints?.length || p.format) && (
                  <div className="lhr-field-meta">
                    {p.defaultValue && (
                      <span className="lhr-meta">
                        <span className="lhr-meta-key">Default</span>
                        <code>{p.defaultValue}</code>
                      </span>
                    )}
                    {p.format && (
                      <span className="lhr-meta">
                        <span className="lhr-meta-key">Format</span>
                        <code>{p.format}</code>
                      </span>
                    )}
                    {p.constraints?.map((c) => (
                      <span key={c} className="lhr-meta">
                        <code>{c}</code>
                      </span>
                    ))}
                    {p.enumValues?.length > 0 && (
                      <span className="lhr-meta lhr-meta-enum">
                        <span className="lhr-meta-key">One of</span>
                        {p.enumValues.map((v) => (
                          <code key={String(v)}>{String(v)}</code>
                        ))}
                      </span>
                    )}
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
