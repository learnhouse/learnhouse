/**
 * Schema tree: one row per field with type, required/optional, nullable,
 * default, format, constraints and enum values. Nested objects and arrays of
 * objects fold into a <details> block, server-rendered with zero JS.
 */

function FieldMeta({ field }) {
  const hasMeta =
    field.defaultValue || field.format || field.constraints?.length || field.enumValues?.length
  if (!hasMeta) return null
  return (
    <div className="lhr-field-meta">
      {field.defaultValue && (
        <span className="lhr-meta">
          <span className="lhr-meta-key">Default</span>
          <code>{field.defaultValue}</code>
        </span>
      )}
      {field.format && (
        <span className="lhr-meta">
          <span className="lhr-meta-key">Format</span>
          <code>{field.format}</code>
        </span>
      )}
      {field.constraints?.map((c) => (
        <span key={c} className="lhr-meta">
          <code>{c}</code>
        </span>
      ))}
      {field.enumValues?.length > 0 && (
        <span className="lhr-meta lhr-meta-enum">
          <span className="lhr-meta-key">One of</span>
          {field.enumValues.map((v) => (
            <code key={String(v)}>{String(v)}</code>
          ))}
        </span>
      )}
    </div>
  )
}

export function FieldRow({ field, showOptional = true }) {
  const nullable = field.nullable && !String(field.type).includes('null')
  return (
    <div className="lhr-field">
      <div className="lhr-field-head">
        <code className="lhr-field-name">{field.name}</code>
        <span className="lhr-field-type">{field.type || 'any'}</span>
        {nullable && <span className="lhr-field-flag">nullable</span>}
        {field.required ? (
          <span className="lhr-field-req">Required</span>
        ) : (
          showOptional && <span className="lhr-field-opt">Optional</span>
        )}
      </div>
      {field.description && <p className="lhr-field-desc">{field.description}</p>}
      <FieldMeta field={field} />
      {field.children?.length > 0 && (
        <details className="lhr-children">
          <summary>
            {field.children.length} child attribute{field.children.length === 1 ? '' : 's'}
          </summary>
          <div className="lhr-fields lhr-fields-nested">
            {field.children.map((child) => (
              <FieldRow key={child.name} field={child} />
            ))}
          </div>
        </details>
      )}
    </div>
  )
}

export default function SchemaFields({ fields, showOptional = true }) {
  if (!fields?.length) return null
  return (
    <div className="lhr-fields">
      {fields.map((field) => (
        <FieldRow key={field.name} field={field} showOptional={showOptional} />
      ))}
    </div>
  )
}
