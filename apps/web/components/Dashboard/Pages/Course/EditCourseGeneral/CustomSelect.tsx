'use client'
import React, { useState, useEffect, useRef, useCallback, useId } from 'react';
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
  activeIndex: number;
  setActiveIndex: (index: number) => void;
  itemValues: string[];
  registerItem: (value: string) => void;
  listboxId: string;
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
  const [activeIndex, setActiveIndex] = useState(-1);
  const [itemValues, setItemValues] = useState<string[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  useEffect(() => {
    setSelectedValue(value);
  }, [value]);

  // Reset item registry when dropdown opens
  useEffect(() => {
    if (isOpen) {
      setItemValues([]);
    }
  }, [isOpen]);

  const registerItem = useCallback((itemValue: string) => {
    setItemValues(prev => {
      if (prev.includes(itemValue)) return prev;
      return [...prev, itemValue];
    });
  }, []);

  const handleValueChange = (newValue: string) => {
    if (disabled) return;
    setSelectedValue(newValue);
    onValueChange(newValue);
    setIsOpen(false);
    setActiveIndex(-1);
  };

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setActiveIndex(-1);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  return (
    <CustomSelectContext.Provider
      value={{
        isOpen,
        setIsOpen,
        selectedValue,
        setSelectedValue,
        onValueChange: handleValueChange,
        disabled,
        activeIndex,
        setActiveIndex,
        itemValues,
        registerItem,
        listboxId,
      }}
    >
      <div ref={containerRef} className={`relative ${className}`}>
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

  const { isOpen, setIsOpen, disabled: contextDisabled, setActiveIndex, itemValues, onValueChange, listboxId } = context;
  const isDisabled = disabled || contextDisabled;

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (isDisabled) return;

    switch (event.key) {
      case 'Enter':
      case ' ':
      case 'ArrowDown':
        event.preventDefault();
        if (!isOpen) {
          setIsOpen(true);
          setActiveIndex(0);
        }
        break;
      case 'ArrowUp':
        event.preventDefault();
        if (!isOpen) {
          setIsOpen(true);
          setActiveIndex(itemValues.length - 1);
        }
        break;
      case 'Escape':
        event.preventDefault();
        setIsOpen(false);
        setActiveIndex(-1);
        break;
    }

    // When open, handle arrow navigation
    if (isOpen) {
      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          setActiveIndex(prev => Math.min(prev + 1, itemValues.length - 1));
          break;
        case 'ArrowUp':
          event.preventDefault();
          setActiveIndex(prev => Math.max(prev - 1, 0));
          break;
        case 'Enter':
        case ' ':
          event.preventDefault();
          if (context.activeIndex >= 0 && context.activeIndex < itemValues.length) {
            onValueChange(itemValues[context.activeIndex]);
          }
          break;
        case 'Home':
          event.preventDefault();
          setActiveIndex(0);
          break;
        case 'End':
          event.preventDefault();
          setActiveIndex(itemValues.length - 1);
          break;
      }
    }
  };

  return (
    <button
      type="button"
      role="combobox"
      aria-expanded={isOpen}
      aria-haspopup="listbox"
      aria-controls={isOpen ? listboxId : undefined}
      disabled={isDisabled}
      className={`flex h-9 w-full items-center justify-between whitespace-nowrap rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs ring-offset-background placeholder:text-muted-foreground focus:outline-hidden focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1 ${className}`}
      onClick={() => !isDisabled && setIsOpen(!isOpen)}
      onKeyDown={handleKeyDown}
    >
      {children}
      <ChevronDown aria-hidden="true" className={`h-4 w-4 opacity-50 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
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

  const { isOpen, disabled, listboxId } = context;

  if (!isOpen || disabled) return null;

  return (
    <div
      role="listbox"
      id={listboxId}
      className={`absolute z-dropdown max-h-96 min-w-[8rem] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95 slide-in-from-top-2 ${className}`}
    >
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

  const { selectedValue, onValueChange, disabled, activeIndex, itemValues, registerItem } = context;
  const itemIndex = itemValues.indexOf(value);
  const isActive = itemIndex === activeIndex;
  const isSelected = selectedValue === value;
  const itemRef = useRef<HTMLDivElement>(null);

  // Register this item's value on mount
  useEffect(() => {
    registerItem(value);
  }, [value, registerItem]);

  // Scroll active item into view
  useEffect(() => {
    if (isActive && itemRef.current) {
      itemRef.current.scrollIntoView({ block: 'nearest' });
    }
  }, [isActive]);

  return (
    <div
      ref={itemRef}
      role="option"
      aria-selected={isSelected}
      className={`relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-2 pr-8 text-sm outline-hidden ${isActive ? 'bg-accent text-accent-foreground' : ''} ${!isActive ? 'hover:bg-accent hover:text-accent-foreground' : ''} ${disabled ? 'opacity-50 cursor-not-allowed' : ''} ${className}`}
      onClick={() => !disabled && onValueChange(value)}
    >
      {children}
      {isSelected && (
        <span className="absolute right-2 flex h-3.5 w-3.5 items-center justify-center">
          <svg aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
