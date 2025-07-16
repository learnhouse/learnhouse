import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';

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
        disabled
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
      className={`flex h-9 w-full items-center justify-between whitespace-nowrap rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs ring-offset-background placeholder:text-muted-foreground focus:outline-hidden focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1 ${className}`}
      onClick={() => !isDisabled && setIsOpen(!isOpen)}
    >
      {children}
      <ChevronDown className={`h-4 w-4 opacity-50 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
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
    <div className={`absolute z-50 max-h-96 min-w-[8rem] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95 slide-in-from-top-2 ${className}`}>
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
      className={`relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-2 pr-8 text-sm outline-hidden focus:bg-accent focus:text-accent-foreground hover:bg-accent hover:text-accent-foreground ${disabled ? 'opacity-50 cursor-not-allowed' : ''} ${className}`}
      onClick={() => !disabled && onValueChange(value)}
    >
      {children}
      {selectedValue === value && (
        <span className="absolute right-2 flex h-3.5 w-3.5 items-center justify-center">
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

  const { selectedValue } = context;

  return <span>{children || selectedValue}</span>;
}; 