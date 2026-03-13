import { useEditorProvider } from '@components/Contexts/Editor/EditorContext'
import { NodeViewContent, NodeViewWrapper } from '@tiptap/react'
import { Info, X } from 'lucide-react'
import React, { useState } from 'react'

interface CalloutOptions {
  dismissible?: boolean;
  variant?: 'default' | 'filled' | 'outlined';
  size?: 'sm' | 'md' | 'lg';
}

function InfoCalloutComponent(props: any) {
  const editorState = useEditorProvider() as any
  const isEditable = editorState?.isEditable ?? false
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
        return 'bg-gray-300 text-gray-700';
      case 'outlined':
        return 'bg-transparent border-2 border-gray-300 text-gray-500';
      default:
        return 'bg-gray-100 text-gray-600';
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
      <div
        className={`w-full flex relative my-4 items-start rounded-xl shadow-inner ${getVariantClasses()} ${getSizeClasses()} max-sm:${options.size === 'sm' ? 'flex-row items-center' : 'flex-col items-start'}`}
        contentEditable={isEditable || undefined}
        suppressContentEditableWarning={true}
      >
        <div className={`flex items-center justify-center shrink-0 mr-2 pl-2 pt-3 max-sm:mr-1 max-sm:pl-1.5 [&_svg]:w-5 [&_svg]:h-5 [&_svg]:min-w-5 ${options.size !== 'sm' ? 'max-sm:pt-2 max-sm:self-start' : 'max-sm:self-center'}`}>
          <Info />
        </div>
        <div className="w-full break-words grow">
          <NodeViewContent className="content" style={{
            margin: '5px',
            padding: '0.5rem',
            border: isEditable ? '2px dashed #1f3a8a12' : 'none',
            borderRadius: '0.5rem',
          }} />
        </div>
        {options.dismissible && !isEditable && (
          <button
            onClick={() => setDismissed(true)}
            className="bg-transparent border-none cursor-pointer flex items-center justify-center p-1 ml-2 rounded-full hover:bg-black/10"
          >
            <X size={16} />
          </button>
        )}
      </div>
    </NodeViewWrapper>
  )
}

export default InfoCalloutComponent
