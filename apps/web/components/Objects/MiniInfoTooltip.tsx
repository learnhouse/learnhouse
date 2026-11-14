import React from 'react';
import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { X } from '@phosphor-icons/react';

interface MiniInfoTooltipProps {
  icon?: React.ReactNode;
  message: string;
  onClose: () => void;
  iconColor?: string;
  iconSize?: number;
  width?: string;
}

// A first-run hint bubble above a control, in the kit tooltip style: white
// card, soft shadow, small arrow, dismiss button.
export default function MiniInfoTooltip({
  icon,
  message,
  onClose,
  iconColor = 'text-neutral-400',
  iconSize = 16,
  width = 'w-56'
}: MiniInfoTooltipProps) {
  const { t } = useTranslation();
  return (
    <motion.div
      role="status"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 6 }}
      className={`absolute bottom-full mb-3 start-1/2 -translate-x-1/2 rtl:translate-x-1/2 bg-white rounded-xl nice-shadow ps-3 pe-7 py-2.5 ${width}`}
      style={{ zIndex: 'var(--z-interactive)' }}
    >
      <div className="flex items-start gap-2">
        {icon && (
          <div className={`${iconColor} mt-px shrink-0`} style={{ width: iconSize, height: iconSize }}>
            {icon}
          </div>
        )}
        <p className="text-xs leading-relaxed text-neutral-600">{message}</p>
      </div>
      <span className="absolute -bottom-1 start-1/2 -ms-1 w-2 h-2 bg-white rotate-45 shadow-[1px_1px_0_rgba(0,0,0,0.04)]" />
      <button
        type="button"
        onClick={onClose}
        aria-label={t('common.close')}
        className="absolute top-1.5 end-1.5 h-5 w-5 inline-flex items-center justify-center rounded-md text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100"
      >
        <X size={11} weight="bold" />
      </button>
    </motion.div>
  );
}
