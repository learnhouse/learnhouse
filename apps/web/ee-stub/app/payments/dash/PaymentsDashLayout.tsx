import React from 'react'

// OSS stub: payments require Enterprise Edition. The page stub 404s, so the
// layout only passes its children through.
export default function PaymentsDashLayout(props: { children: React.ReactNode; params?: Promise<any> }) {
  return <>{props.children}</>
}
