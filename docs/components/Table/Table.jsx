'use client'

export function Table({ children, ...props }) {
  return (
    <div className="lh-table-wrap">
      <table className="lh-table" {...props}>{children}</table>
    </div>
  )
}

export function Thead({ children, ...props }) {
  return <thead className="lh-table-head" {...props}>{children}</thead>
}

export function Tbody({ children, ...props }) {
  return <tbody className="lh-table-body" {...props}>{children}</tbody>
}

export function Tr({ children, ...props }) {
  return <tr className="lh-table-row" {...props}>{children}</tr>
}

export function Th({ children, ...props }) {
  return <th className="lh-table-th" {...props}>{children}</th>
}

export function Td({ children, ...props }) {
  return <td className="lh-table-td" {...props}>{children}</td>
}
