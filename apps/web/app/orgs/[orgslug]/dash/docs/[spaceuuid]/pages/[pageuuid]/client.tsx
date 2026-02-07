'use client'

import React from 'react'
import DocPageEditor from '@components/Dashboard/Pages/Docs/DocPageEditor'

interface DocPageEditorClientProps {
  org_id: number
  orgslug: string
  spaceuuid: string
  pageuuid: string
}

const DocPageEditorClient = ({ org_id, orgslug, spaceuuid, pageuuid }: DocPageEditorClientProps) => {
  return (
    <DocPageEditor pageuuid={pageuuid} spaceuuid={spaceuuid} orgId={org_id} orgslug={orgslug} />
  )
}

export default DocPageEditorClient
