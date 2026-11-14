'use client'
import React from 'react'
import FeatureGate from '@components/Dashboard/Shared/FeatureGate/FeatureGate'

// OSS stub: SCIM provisioning requires Enterprise Edition (the gate shows why).
export default function ScimProvisioningPage() {
  return (
    <FeatureGate feature="scim">
      <></>
    </FeatureGate>
  )
}
