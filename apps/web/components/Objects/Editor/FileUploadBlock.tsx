import { cn } from '@/lib/utils'
import { UploadIcon } from '@radix-ui/react-icons'
import { Loader } from 'lucide-react'
import type React from 'react'
import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
} from 'react'

const FileUploadBlockInput: React.FC<InputHTMLAttributes<HTMLInputElement>> = ({
  onChange,
  className,
  ...props
}) => {
  return (
    <input
      className={cn(
        'cursor-pointer rounded-lg p-3 file:mr-4 file:rounded-full file:border-0 file:file:bg-gray-200 file:px-4 file:py-2 file:text-gray-500 hover:file:cursor-pointer',
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
        'flex items-center space-x-2 rounded-lg bg-gray-200 p-2 px-3 text-gray-500 transition enabled:hover:bg-gray-300 disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      onClick={onClick}
      {...props}
    >
      <UploadIcon />
      <p>Submit</p>
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
    return <Loader className="animate-spin text-gray-200" size={50} />

  if (!isEditable && isEmpty)
    return (
      <div className="flex items-center gap-5">
        {<Icon className="text-gray-200" size={50} />}
        <p>No file available for preview.</p>
      </div>
    )

  return (
    <>
      {<Icon className="text-gray-200" size={50} />}
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
      <div
        className="border-gray-150 flex items-center justify-center space-x-3 rounded-xl border-2 border-dashed bg-gray-50 px-3 py-7 text-sm text-gray-900"
        contentEditable={false}
      >
        <FileUploadBlock isEmpty {...props}>
          {children}
        </FileUploadBlock>
      </div>
    )
  )
}

export {
  FileUploadBlockWrapper as FileUploadBlock,
  FileUploadBlockInput,
  FileUploadBlockButton,
}
