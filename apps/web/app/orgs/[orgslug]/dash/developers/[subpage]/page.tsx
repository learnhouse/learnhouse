'use client'
import React, { use } from 'react'
import OrgEditAPIAccess from '@components/Dashboard/Pages/Org/OrgEditAPIAccess/OrgEditAPIAccess'
import OrgEditAutomations from '@components/Dashboard/Pages/Org/OrgEditAutomations/OrgEditAutomations'
import OrgEditDomains from '@components/Dashboard/Pages/Org/OrgEditDomains/OrgEditDomains'
import OrgEditSEO from '@components/Dashboard/Pages/Org/OrgEditSEO/OrgEditSEO'
import OrgEditSSO from '@components/Dashboard/Pages/Org/OrgEditSSO/OrgEditSSO'
import OrgEditMCP from '@components/Dashboard/Pages/Org/OrgEditMCP/OrgEditMCP'
import OrgEditLTI from '@ee/components/LTI/OrgEditLTI'

export type DevParams = {
  subpage: string
  orgslug: string
}

// The header and tabs live in ../layout.tsx; this only swaps the tab body.
function DevelopersPage(props: { params: Promise<DevParams> }) {
  const params = use(props.params)
  switch (params.subpage) {
    case 'mcp':
      return <OrgEditMCP />
    case 'api':
      return <OrgEditAPIAccess />
    case 'automations':
      return <OrgEditAutomations />
    case 'domains':
      return <OrgEditDomains />
    case 'seo':
      return <OrgEditSEO />
    case 'sso':
      return <OrgEditSSO />
    case 'lti':
      return <OrgEditLTI />
    default:
      return null
  }
}

export default DevelopersPage
