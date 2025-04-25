import React, { useState, useEffect } from 'react'
import styled from 'styled-components'
import { CheckIcon, Cross2Icon } from '@radix-ui/react-icons'

interface LinkInputTooltipProps {
  onSave: (url: string) => void
  onCancel: () => void
  currentUrl?: string
}

const LinkInputTooltip: React.FC<LinkInputTooltipProps> = ({ onSave, onCancel, currentUrl }) => {
  const [url, setUrl] = useState(currentUrl || '')

  useEffect(() => {
    setUrl(currentUrl || '')
  }, [currentUrl])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (url) {
      // Ensure the URL has a protocol
      const formattedUrl = url.startsWith('http://') || url.startsWith('https://') 
        ? url 
        : `https://${url}`
      onSave(formattedUrl)
    }
  }

  return (
    <TooltipContainer>
      <Form onSubmit={handleSubmit}>
        <Input
          type="text"
          placeholder="Enter URL"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          autoFocus
        />
        <ButtonGroup>
          <SaveButton type="submit" disabled={!url}>
            <CheckIcon />
          </SaveButton>
          <CancelButton type="button" onClick={onCancel}>
            <Cross2Icon />
          </CancelButton>
        </ButtonGroup>
      </Form>
    </TooltipContainer>
  )
}

const TooltipContainer = styled.div`
  position: absolute;
  top: 100%;
  left: 0;
  background: white;
  border: 1px solid rgba(217, 217, 217, 0.5);
  border-radius: 6px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  z-index: 1000;
  padding: 8px;
  margin-top: 4px;
`

const Form = styled.form`
  display: flex;
  align-items: center;
  gap: 4px;
`

const Input = styled.input`
  padding: 4px 8px;
  border: 1px solid rgba(217, 217, 217, 0.5);
  border-radius: 4px;
  font-size: 12px;
  width: 200px;

  &:focus {
    outline: none;
    border-color: rgba(217, 217, 217, 0.8);
  }
`

const ButtonGroup = styled.div`
  display: flex;
  gap: 2px;
`

const Button = styled.button`
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  background: rgba(217, 217, 217, 0.24);
  transition: background 0.2s;

  &:hover {
    background: rgba(217, 217, 217, 0.48);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`

const SaveButton = styled(Button)`
  color: #4CAF50;
`

const CancelButton = styled(Button)`
  color: #F44336;
`

export default LinkInputTooltip 