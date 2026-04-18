import { useEditorProvider } from '@components/Contexts/Editor/EditorContext'
import { NodeViewContent, NodeViewWrapper } from '@tiptap/react'
import { AlertTriangle, X } from 'lucide-react'
import React, { useState } from 'react'

interface CalloutOptions {
  dismissible?: boolean;
  variant?: 'default' | 'filled' | 'outlined';
  size?: 'sm' | 'md' | 'lg';
}

function WarningCalloutComponent(props: any) {
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
      <div
        className={`w-full flex relative my-4 items-start rounded-lg shadow-inner ${getVariantClasses()} ${getSizeClasses()} max-sm:${options.size === 'sm' ? 'flex-row items-center' : 'flex-col items-start'}`}
        contentEditable={isEditable || undefined}
        suppressContentEditableWarning={true}
      >
        <div className={`flex items-center justify-center shrink-0 me-2 ps-2 pt-3 max-sm:me-1 max-sm:ps-1.5 [&_svg]:w-5 [&_svg]:h-5 [&_svg]:min-w-5 ${options.size !== 'sm' ? 'max-sm:pt-2 max-sm:self-start' : 'max-sm:self-center'}`}>
          <AlertTriangle />
        </div>
        <div className="w-full break-words grow">
          <NodeViewContent className="content" style={{
            margin: '5px',
            padding: '0.5rem',
            border: isEditable ? '2px dashed #713f1117' : 'none',
            borderRadius: '0.5rem',
          }} />
        </div>
        {options.dismissible && !isEditable && (
          <button
            onClick={() => setDismissed(true)}
            className="bg-transparent border-none cursor-pointer flex items-center justify-center p-1 ms-2 rounded-full hover:bg-black/10"
          >
            <X size={16} />
          </button>
        )}
      </div>
    </NodeViewWrapper>
  )
}

export default WarningCalloutComponent
