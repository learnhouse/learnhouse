import { useEditorProvider } from '@components/Contexts/Editor/EditorContext'
import { NodeViewContent, NodeViewWrapper } from '@tiptap/react'
import { AlertTriangle, X } from 'lucide-react'
import React, { useState } from 'react'
import styled from 'styled-components'

interface CalloutOptions {
  dismissible?: boolean;
  variant?: 'default' | 'filled' | 'outlined';
  size?: 'sm' | 'md' | 'lg';
}

const IconWrapper = styled.div<{ size?: string }>`
  display: flex;
  align-items: center;
  justify-content: center;
  shrink: 0;
  margin-right: 0.5rem;
  padding-left: 0.5rem;
  
  svg {
    width: 20px;
    height: 20px;
    min-width: 20px;
  }
  
  @media (max-width: 640px) {
    margin-right: 0.25rem;
    padding-left: 0.375rem;
    padding-top: ${props => props.size === 'sm' ? '0' : '0.5rem'};
    align-self: ${props => props.size === 'sm' ? 'center' : 'flex-start'};
  }
`

const ContentWrapper = styled.div`
  width: 100%;
  overflow-wrap: break-word;
`

const DismissButton = styled.button`
  background: transparent;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4px;
  margin-left: 8px;
  border-radius: 50%;
  
  &:hover {
    background-color: rgba(0, 0, 0, 0.1);
  }
`

const CalloutWrapper = styled.div<{ size?: string }>`
  width: 100%;
  display: flex;
  position: relative;
  margin: 1rem 0;
  
  @media (max-width: 640px) {
    flex-direction: ${props => props.size === 'sm' ? 'row' : 'column'};
    align-items: ${props => props.size === 'sm' ? 'center' : 'flex-start'};
  }

  svg {
    padding: 0;
  }

  .content {
    margin: 5px;
    padding: 0.5rem;
    border: ${(props) =>
      props.contentEditable ? '2px dashed #713f1117' : 'none'};
    border-radius: 0.5rem;
    
    @media (max-width: 640px) {
      margin: ${props => props.size === 'sm' ? '3px' : '5px 0'};
      padding: ${props => props.size === 'sm' ? '0.25rem' : '0.5rem'};
      width: 100%;
    }
  }
`

function WarningCalloutComponent(props: any) {
  const editorState = useEditorProvider() as any
  const isEditable = editorState.isEditable
  const [dismissed, setDismissed] = useState(false)
  
  // Extract options from props or use defaults
  const options: CalloutOptions = {
    dismissible: props.node?.attrs?.dismissible || false,
    variant: props.node?.attrs?.variant || 'default',
    size: props.node?.attrs?.size || 'md',
  }
  
  if (dismissed) return null;
  
  const getVariantClasses = () => {
    switch(options.variant) {
      case 'filled':
        return 'bg-yellow-500 text-white';
      case 'outlined':
        return 'bg-transparent border-2 border-yellow-500 text-yellow-700';
      default:
        return 'bg-yellow-200 text-yellow-900';
    }
  }
  
  const getSizeClasses = () => {
    switch(options.size) {
      case 'sm': return 'py-1 px-2 text-sm';
      case 'lg': return 'py-3 px-4 text-lg';
      default: return 'py-2 px-3';
    }
  }

  return (
    <NodeViewWrapper>
      <CalloutWrapper
        className={`flex items-center rounded-lg shadow-inner ${getVariantClasses()} ${getSizeClasses()}`}
        contentEditable={isEditable}
        size={options.size}
      >
        <IconWrapper size={options.size}>
          <AlertTriangle />
        </IconWrapper>
        <ContentWrapper className="grow">
          <NodeViewContent contentEditable={isEditable} className="content" />
        </ContentWrapper>
        {options.dismissible && !isEditable && (
          <DismissButton onClick={() => setDismissed(true)}>
            <X size={16} />
          </DismissButton>
        )}
      </CalloutWrapper>
    </NodeViewWrapper>
  )
}

export default WarningCalloutComponent