import { Loader2, Upload } from 'lucide-react'
import React, {
  ButtonHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
} from 'react'
import { cn } from '@/lib/utils'

const FileUploadBlockInput: React.FC<InputHTMLAttributes<HTMLInputElement>> = ({
  onChange,
  className,
  ...props
}) => {
  return (
    <input
      className={cn(
        'p-3 rounded-lg file:me-4 file:py-2 file:px-4 file:rounded-full file:border-0 hover:file:cursor-pointer file:bg-slate-200 cursor-pointer file:text-slate-600 text-sm',
        className
      )}
      onChange={onChange}
      type="file"
      required
      {...props}
    />
  )
}

const FileUploadBlockButton: React.FC<
  ButtonHTMLAttributes<HTMLButtonElement>
> = ({ onClick, className, ...props }) => {
  return (
    <button
      className={cn(
        'p-2 px-4 bg-slate-700 hover:bg-slate-800 rounded-lg text-white enabled:hover:bg-slate-800 transition-colors gap-2 items-center flex disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium',
        className
      )}
      onClick={onClick}
      {...props}
    >
      <Upload size={16} />
      <span>Upload</span>
    </button>
  )
}

interface UploadBlockComponentProps extends HTMLAttributes<HTMLDivElement> {
  isLoading: boolean
  isEditable: boolean
  isEmpty: boolean
  Icon: any
  children: React.ReactNode
}

function FileUploadBlock({
  isLoading,
  isEditable,
  isEmpty,
  Icon,
  children,
}: UploadBlockComponentProps) {
  if (isLoading)
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="animate-spin text-slate-400" size={32} />
      </div>
    )

  if (!isEditable && isEmpty)
    return (
      <div className="flex items-center justify-center gap-3 py-8 bg-white rounded-lg nice-shadow">
        {<Icon className="text-slate-300" size={32} />}
        <p className="text-slate-500">No file available for preview.</p>
      </div>
    )

  return (
    <>
      {<Icon className="text-slate-300" size={40} />}
      {children}
    </>
  )
}

function FileUploadBlockWrapper({
  children,
  isEmpty,
  ...props
}: UploadBlockComponentProps) {
  return (
    isEmpty && (
      <div className="flex items-center justify-center gap-4 py-8 bg-white rounded-lg text-slate-700 px-4 border-2 border-dashed border-slate-200 text-sm" contentEditable={false}>
        <FileUploadBlock isEmpty {...props}>{children}</FileUploadBlock>
      </div>
    )
  )
}

export {
  FileUploadBlockWrapper as FileUploadBlock,
  FileUploadBlockInput,
  FileUploadBlockButton,
}
