import React from 'react';
import { motion } from 'framer-motion';

interface MiniInfoTooltipProps {
  icon?: React.ReactNode;
  message: string;
  onClose: () => void;
  iconColor?: string;
  iconSize?: number;
  width?: string;
}

export default function MiniInfoTooltip({
  icon,
  message,
  onClose,
  iconColor = 'text-teal-600',
  iconSize = 20,
  width = 'w-48'
}: MiniInfoTooltipProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 10 }}
      className={`absolute -top-20 left-1/2 transform -translate-x-1/2 bg-white rounded-lg nice-shadow p-3 ${width}`}
    >
      <div className="flex items-center space-x-3">
        {icon && (
          <div className={`${iconColor} flex-shrink-0`} style={{ width: iconSize, height: iconSize }}>
            {icon}
          </div>
        )}
        <p className="text-sm text-gray-700">{message}</p>
      </div>
      <div className="absolute -bottom-2 left-1/2 transform -translate-x-1/2 w-4 h-4 bg-white rotate-45"></div>
      <button
        onClick={onClose}
        className="absolute top-1 right-1 text-gray-400 hover:text-gray-600"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      </button>
    </motion.div>
  );
} 