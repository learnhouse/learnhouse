import { useEditorProvider } from '@components/Contexts/Editor/EditorContext'
import { NodeViewContent, NodeViewWrapper } from '@tiptap/react'
import { AlertCircle } from 'lucide-react'
import React from 'react'
import styled from 'styled-components'

function InfoCalloutComponent(props: any) {
  const editorState = useEditorProvider() as any
  const isEditable = editorState.isEditable

  return (
    <NodeViewWrapper>
      <InfoCalloutWrapper
        className="flex space-x-2 items-center bg-blue-200 rounded-lg text-blue-900 px-3 shadow-inner"
        contentEditable={isEditable}
      >
        <AlertCircle />{' '}
        <NodeViewContent contentEditable={isEditable} className="content" />
      </InfoCalloutWrapper>
    </NodeViewWrapper>
  )
}

const InfoCalloutWrapper = styled.div`
  svg {
    padding: 3px;
  }

  .content {
    margin: 5px;
    padding: 0.5rem;
    border: ${(props) =>
      props.contentEditable ? '2px dashed #1f3a8a12' : 'none'};
    border-radius: 0.5rem;
  }
`

export default InfoCalloutComponent
