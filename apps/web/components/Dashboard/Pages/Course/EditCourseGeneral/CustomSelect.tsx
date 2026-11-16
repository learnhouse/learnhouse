'use client'
import React, { useState, useEffect } from 'react';
import { CaretDown } from '@phosphor-icons/react'

interface CustomSelectProps {
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  children: React.ReactNode;
}

interface CustomSelectItemProps {
  value: string;
  children: React.ReactNode;
  className?: string;
}

interface CustomSelectTriggerProps {
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
}

interface CustomSelectContentProps {
  children: React.ReactNode;
  className?: string;
}

const CustomSelectContext = React.createContext<{
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  selectedValue: string;
  setSelectedValue: (value: string) => void;
  onValueChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
} | null>(null);

export const CustomSelect: React.FC<CustomSelectProps> = ({
  value,
  onValueChange,
  placeholder,
  className = '',
  disabled = false,
  children
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedValue, setSelectedValue] = useState(value);

  useEffect(() => {
    setSelectedValue(value);
  }, [value]);

  const handleValueChange = (newValue: string) => {
    if (disabled) return;
    setSelectedValue(newValue);
    onValueChange(newValue);
    setIsOpen(false);
  };

  return (
    <CustomSelectContext.Provider
      value={{
        isOpen,
        setIsOpen,
        selectedValue,
        setSelectedValue,
        onValueChange: handleValueChange,
        disabled,
        placeholder
      }}
    >
      <div className={`relative ${className}`}>
        {children}
      </div>
    </CustomSelectContext.Provider>
  );
};

export const CustomSelectTrigger: React.FC<CustomSelectTriggerProps> = ({
  children,
  className = '',
  disabled = false
}) => {
  const context = React.useContext(CustomSelectContext);
  if (!context) {
    throw new Error('CustomSelectTrigger must be used within CustomSelect');
  }

  const { isOpen, setIsOpen, disabled: contextDisabled } = context;
  const isDisabled = disabled || contextDisabled;

  return (
    <button
      type="button"
      disabled={isDisabled}
      className={`flex h-10 w-full items-center justify-between whitespace-nowrap rounded-xl bg-white px-3.5 text-sm text-neutral-800 ring-1 ring-inset ring-neutral-200 transition-shadow focus:outline-none focus:ring-2 focus:ring-neutral-900/15 disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1 ${className}`}
      onClick={() => !isDisabled && setIsOpen(!isOpen)}
    >
      {children}
      <CaretDown className={`h-4 w-4 text-neutral-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
    </button>
  );
};

export const CustomSelectContent: React.FC<CustomSelectContentProps> = ({
  children,
  className = ''
}) => {
  const context = React.useContext(CustomSelectContext);
  if (!context) {
    throw new Error('CustomSelectContent must be used within CustomSelect');
  }

  const { isOpen, disabled } = context;

  if (!isOpen || disabled) return null;

  return (
    <div className={`absolute z-dropdown mt-1.5 max-h-96 min-w-[8rem] w-full overflow-hidden rounded-xl bg-white text-neutral-800 nice-shadow animate-in fade-in-0 zoom-in-95 slide-in-from-top-2 ${className}`}>
      <div className="p-1">
        {children}
      </div>
    </div>
  );
};

export const CustomSelectItem: React.FC<CustomSelectItemProps> = ({
  value,
  children,
  className = ''
}) => {
  const context = React.useContext(CustomSelectContext);
  if (!context) {
    throw new Error('CustomSelectItem must be used within CustomSelect');
  }

  const { selectedValue, onValueChange, disabled } = context;

  return (
    <div
      className={`relative flex w-full cursor-pointer select-none items-center rounded-lg py-2 ps-2.5 pe-8 text-sm outline-hidden hover:bg-neutral-100 ${selectedValue === value ? 'font-semibold text-neutral-900' : ''} ${disabled ? 'opacity-50 cursor-not-allowed' : ''} ${className}`}
      onClick={() => !disabled && onValueChange(value)}
    >
      {children}
      {selectedValue === value && (
        <span className="absolute end-2 flex h-3.5 w-3.5 items-center justify-center">
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </span>
      )}
    </div>
  );
};

export const CustomSelectValue: React.FC<{ children?: React.ReactNode }> = ({
  children
}) => {
  const context = React.useContext(CustomSelectContext);
  if (!context) {
    throw new Error('CustomSelectValue must be used within CustomSelect');
  }

  const { selectedValue, placeholder } = context;
  const content = children || selectedValue;

  // Never render an empty trigger: fall back to the placeholder.
  return content ? <span>{content}</span> : <span className="text-neutral-400">{placeholder ?? '—'}</span>;
}; 