import React from 'react'
import * as Form from '@radix-ui/react-form'
import { Info } from 'lucide-react'

interface FormLayoutProps {
  children: React.ReactNode
  onSubmit: (e: any) => void
  className?: string
}

const FormLayout = ({ children, onSubmit, className }: FormLayoutProps) => {
  return (
    <Form.Root onSubmit={onSubmit} className={className}>
      {children}
    </Form.Root>
  )
}

export const FormLabelAndMessage = (props: {
  label: string
  message?: string
}) => (
  <div className="flex items-center space-x-3">
    <FormLabel className="grow text-sm">{props.label}</FormLabel>
    {(props.message && (
      <div className="text-red-700 text-sm items-center  rounded-md flex  space-x-1">
        <Info size={10} />
        <div>{props.message}</div>
      </div>
    )) || <></>}
  </div>
)

export const FormRoot = React.forwardRef<HTMLFormElement, React.ComponentPropsWithoutRef<typeof Form.Root>>(
  ({ className, ...props }, ref) => (
    <Form.Root ref={ref} className={`m-[7px] ${className || ''}`} {...props} />
  )
)
FormRoot.displayName = 'FormRoot'

export const FormField = React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<typeof Form.Field>>(
  ({ className, ...props }, ref) => (
    <Form.Field ref={ref} className={`grid mb-2.5 ${className || ''}`} {...props} />
  )
)
FormField.displayName = 'FormField'

export const FormLabel = React.forwardRef<HTMLLabelElement, React.ComponentPropsWithoutRef<typeof Form.Label>>(
  ({ className, ...props }, ref) => (
    <Form.Label ref={ref} className={`font-medium leading-[35px] text-black ${className || ''}`} {...props} />
  )
)
FormLabel.displayName = 'FormLabel'

export const FormMessage = React.forwardRef<HTMLSpanElement, React.ComponentPropsWithoutRef<typeof Form.Message>>(
  ({ className, ...props }, ref) => (
    <Form.Message ref={ref} className={`text-[13px] text-white opacity-80 ${className || ''}`} {...props} />
  )
)
FormMessage.displayName = 'FormMessage'

export const Flex = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={`flex ${className || ''}`} {...props} />
  )
)
Flex.displayName = 'Flex'

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={`box-border w-full inline-flex items-center justify-center rounded h-[35px] leading-none px-2.5 text-[15px] text-[#7c7c7c] bg-[#fbfdff] shadow-[0_0_0_1px_#edeeef] hover:shadow-[0_0_0_1px_#edeeef] focus:shadow-[0_0_0_2px_#edeeef] selection:bg-black selection:text-white border-none outline-none ${className || ''}`}
      {...props}
    />
  )
)
Input.displayName = 'Input'

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={`box-border w-full inline-flex items-center justify-center rounded resize-none p-2.5 text-[15px] text-[#7c7c7c] bg-[#fbfdff] shadow-[0_0_0_1px_#edeeef] hover:shadow-[0_0_0_1px_#edeeef] focus:shadow-[0_0_0_2px_#edeeef] selection:bg-black selection:text-white border-none outline-none ${className || ''}`}
      {...props}
    />
  )
)
Textarea.displayName = 'Textarea'

export const ButtonBlack = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { state?: 'loading' | 'none' }>(
  ({ className, state, ...props }, ref) => (
    <button
      ref={ref}
      className={`inline-flex items-center justify-center rounded-lg px-[15px] text-[15px] leading-none font-medium h-[35px] bg-black text-white hover:bg-[#181818] hover:cursor-pointer focus:shadow-[0_0_0_2px_black] outline-none border-none ${
        state === 'loading' ? 'pointer-events-none bg-[#808080]' : ''
      } ${className || ''}`}
      {...props}
    />
  )
)
ButtonBlack.displayName = 'ButtonBlack'

export default FormLayout
