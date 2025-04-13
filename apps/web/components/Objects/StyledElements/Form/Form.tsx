import React from 'react'
import * as Form from '@radix-ui/react-form'
import { styled } from '@stitches/react'
import { blackA } from '@radix-ui/colors'
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

export const FormRoot = styled(Form.Root, {
  margin: 7,
})

export const FormField = styled(Form.Field, {
  display: 'grid',
  marginBottom: 10,
})

export const FormLabel = styled(Form.Label, {
  fontWeight: 500,
  lineHeight: '35px',
  color: 'black',
})

export const FormMessage = styled(Form.Message, {
  fontSize: 13,
  color: 'white',
  opacity: 0.8,
})

export const Flex = styled('div', { display: 'flex' })

export const inputStyles = {
  all: 'unset',
  boxSizing: 'border-box',
  width: '100%',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 4,
  fontSize: 15,
  color: '#7c7c7c',
  background: '#fbfdff',
  boxShadow: `0 0 0 1px #edeeef`,
  '&:hover': { boxShadow: `0 0 0 1px #edeeef` },
  '&:focus': { boxShadow: `0 0 0 2px #edeeef` },
  '&::selection': { backgroundColor: blackA.blackA9, color: 'white' },
}

export const Input = styled('input', {
  ...inputStyles,
  height: 35,
  lineHeight: 1,
  padding: '0 10px',
  border: 'none',
})

export const Textarea = styled('textarea', {
  ...inputStyles,
  resize: 'none',
  padding: 10,
})

export const ButtonBlack = styled('button', {
  variants: {
    state: {
      loading: {
        pointerEvents: 'none',
        backgroundColor: '#808080',
      },
      none: {},
    },
  },
  all: 'unset',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 8,
  padding: '0 15px',
  fontSize: 15,
  lineHeight: 1,
  fontWeight: 500,
  height: 35,

  background: '#000000',
  color: '#FFFFFF',
  '&:hover': { backgroundColor: '#181818', cursor: 'pointer' },
  '&:focus': { boxShadow: `0 0 0 2px black` },
})

export default FormLayout
