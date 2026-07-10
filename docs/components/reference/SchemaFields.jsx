/**
 * Stripe-style definition list of schema fields.
 * Nested object/array-of-object fields render inside a collapsible
 * <details> block — server-rendered, zero JS.
 */
function FieldRow({ field }) {
  return (
    <div className="lh-ref-field">
      <div className="lh-ref-field-head">
        <code className="lh-ref-field-name">{field.name}</code>
        <span className="lh-ref-field-type">{field.type}</span>
        {field.required && <span className="lh-ref-pill lh-ref-pill-required">required</span>}
        {field.nullable && !String(field.type).includes('null') && (
          <span className="lh-ref-pill">nullable</span>
        )}
      </div>
      {field.description && <p className="lh-ref-field-desc">{field.description}</p>}
      {field.enumValues && (
        <div className="lh-ref-field-enum">
          {field.enumValues.map((v) => (
            <code key={String(v)} className="lh-ref-enum-chip">
              {String(v)}
            </code>
          ))}
        </div>
      )}
      {field.children?.length > 0 && (
        <details className="lh-ref-field-children">
          <summary>Show child attributes</summary>
          <div className="lh-ref-fields">
            {field.children.map((child) => (
              <FieldRow key={child.name} field={child} />
            ))}
          </div>
        </details>
      )}
    </div>
  )
}

export default function SchemaFields({ fields }) {
  if (!fields?.length) return null
  return (
    <div className="lh-ref-fields">
      {fields.map((field) => (
        <FieldRow key={field.name} field={field} />
      ))}
    </div>
  )
}
