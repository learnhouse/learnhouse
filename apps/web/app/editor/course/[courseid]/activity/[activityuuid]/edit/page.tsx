
import { default as React } from 'react'
import { Metadata } from 'next'
import EditorOptionsProvider from '@components/Contexts/Editor/EditorContext'
import AIEditorProvider from '@components/Contexts/AI/AIEditorContext'
import EditorLoader from '@components/Objects/Editor/EditorLoader'

type MetadataProps = {
  params: Promise<{ orgslug: string; courseid: string; activityuuid: string }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}

export async function generateMetadata(props: MetadataProps): Promise<Metadata> {
  const params = await props.params;
  return {
    title: `Edit Activity`,
    description: 'Edit course activity content',
  }
}

const EditActivity = async (params: any) => {
  const activityuuid = (await params.params).activityuuid
  const courseid = (await params.params).courseid

  return (
    <EditorOptionsProvider options={{ isEditable: true }}>
      <AIEditorProvider>
        <EditorLoader courseid={courseid} activityuuid={activityuuid} />
      </AIEditorProvider>
    </EditorOptionsProvider>
  )
}

export default EditActivity
