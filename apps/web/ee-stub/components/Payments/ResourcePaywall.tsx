import React from 'react'

// OSS stub: paywalls require Enterprise Edition, so content is always shown.
export function useResourcePaywall(_orgId: number, _resourceUuid: string) {
  return { data: undefined, isLoading: false, paywall: null as any, locked: false, signedIn: false }
}

export default function ResourcePaywall(props: {
  orgId: number
  orgslug: string
  resourceUuid: string
  resourceName?: string
  children: React.ReactNode
}) {
  return <>{props.children}</>
}
