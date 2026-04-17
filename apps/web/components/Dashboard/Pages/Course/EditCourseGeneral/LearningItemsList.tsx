import React, { useState, useEffect, useRef, memo, useCallback, lazy, Suspense } from 'react';
import { Plus, X, Link as LinkIcon, ExternalLink } from 'lucide-react';
const Picker = lazy(() => import('@emoji-mart/react'));

interface LearningItem {
  id: string;
  text: string;
  emoji: string;
  link?: string;
}

interface LearningItemsListProps {
  value: string;
  onChange: (value: string) => void;
  error?: string;
}

const LearningItemsList = ({ value, onChange, error }: LearningItemsListProps) => {
  const [items, setItems] = useState<LearningItem[]>([]);
  const [showEmojiPicker, setShowEmojiPicker] = useState<string | null>(null);
  const [showLinkInput, setShowLinkInput] = useState<string | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const linkInputRef = useRef<HTMLDivElement>(null);
  const initializedRef = useRef(false);
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const linkInputFieldRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const previousValueRef = useRef<string>(value);
  const isInternalUpdateRef = useRef(false);

  const addItem = () => {
    const newItem: LearningItem = { id: Date.now().toString(), text: '', emoji: '📝' };
    const newItems = [...items, newItem];
    setItems(newItems);
    const newValue = JSON.stringify(newItems);
    isInternalUpdateRef.current = true;
    previousValueRef.current = newValue;
    onChange(newValue);
    setTimeout(() => inputRefs.current[newItem.id]?.focus(), 0);
  };

  useEffect(() => {
    if (isInternalUpdateRef.current) {
      isInternalUpdateRef.current = false;
      previousValueRef.current = value;
      return;
    }
    if (previousValueRef.current === value) return;
    previousValueRef.current = value;
    try {
      if (value) {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) {
          setItems(parsed);
          initializedRef.current = true;
        } else if (!initializedRef.current) {
          initDefault();
        }
      } else if (!initializedRef.current) {
        initDefault();
      }
    } catch {
      if (!initializedRef.current) initDefault();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const initDefault = () => {
    const newItem: LearningItem = { id: 'default-1', text: '', emoji: '📝' };
    setItems([newItem]);
    isInternalUpdateRef.current = true;
    onChange(JSON.stringify([newItem]));
    initializedRef.current = true;
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowEmojiPicker(null);
      }
      if (linkInputRef.current && !linkInputRef.current.contains(e.target as Node)) {
        setShowLinkInput(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const updateItems = useCallback((newItems: LearningItem[]) => {
    setItems(newItems);
    const newValue = JSON.stringify(newItems);
    isInternalUpdateRef.current = true;
    previousValueRef.current = newValue;
    onChange(newValue);
  }, [onChange]);

  const removeItem = useCallback((id: string) => {
    updateItems(items.filter(item => item.id !== id));
  }, [items, updateItems]);

  const updateItemText = useCallback((id: string, text: string) => {
    updateItems(items.map(item => item.id === id ? { ...item, text } : item));
  }, [items, updateItems]);

  const updateItemEmoji = useCallback((id: string, emoji: string) => {
    updateItems(items.map(item => item.id === id ? { ...item, emoji } : item));
    setShowEmojiPicker(null);
    setTimeout(() => inputRefs.current[id]?.focus(), 0);
  }, [items, updateItems]);

  const updateItemLink = useCallback((id: string, link: string) => {
    updateItems(items.map(item => item.id === id ? { ...item, link } : item));
  }, [items, updateItems]);

  return (
    <div className="space-y-1">
      {/* No overflow-hidden so emoji picker and emoji itself aren't clipped */}
      <div className="rounded-xl border border-gray-200 bg-white">

        {items.length === 0 && (
          <div className="px-4 py-6 text-center text-sm text-gray-400 border-b border-gray-100">
            No learning objectives yet
          </div>
        )}

        {items.map((item) => (
          <div key={item.id} className="group border-b border-gray-100 last:border-b-0">

            {/* Main row — emoji sits OUTSIDE the shadowed input box */}
            <div className="flex items-center gap-2.5 px-3 py-2">

              {/* Emoji — outside the shadow box, not clipped */}
              <div className="relative shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setShowEmojiPicker(showEmojiPicker === item.id ? null : item.id);
                    setShowLinkInput(null);
                  }}
                  className="text-xl leading-none hover:scale-110 transition-transform select-none"
                  title="Change emoji"
                >
                  {item.emoji}
                </button>
                {showEmojiPicker === item.id && (
                  <div ref={pickerRef} className="absolute z-50 top-9 left-0">
                    <Suspense fallback={
                      <div className="p-3 text-xs text-gray-400 bg-white border border-gray-200 rounded-lg shadow-lg w-[280px]">
                        Loading…
                      </div>
                    }>
                      <Picker
                        onEmojiSelect={(e: any) => updateItemEmoji(item.id, e.native)}
                        theme="light"
                        previewPosition="none"
                        searchPosition="top"
                        maxFrequentRows={0}
                        autoFocus={false}
                      />
                    </Suspense>
                  </div>
                )}
              </div>

              {/* Shadowed input box — text + actions */}
              <div className="flex-1 flex items-center gap-2 bg-gray-50 shadow-inner rounded-lg px-3 py-1.5 border border-gray-100 min-w-0">
                <input
                  ref={(el) => { inputRefs.current[item.id] = el; }}
                  type="text"
                  value={item.text}
                  onChange={(e) => updateItemText(item.id, e.target.value)}
                  placeholder="What will learners achieve?"
                  className="flex-1 text-sm text-gray-700 bg-transparent border-none outline-none placeholder:text-gray-300 min-w-0"
                />

                {/* Link chip when link is set */}
                {item.link && (
                  <button
                    type="button"
                    onClick={() => {
                      setShowLinkInput(showLinkInput === item.id ? null : item.id);
                      setShowEmojiPicker(null);
                    }}
                    className="flex items-center gap-1 text-[11px] text-blue-600 bg-blue-50 hover:bg-blue-100 px-2 py-0.5 rounded-full shrink-0 transition-colors"
                    title={item.link}
                  >
                    <ExternalLink size={10} />
                    <span className="max-w-[72px] truncate">{item.link.replace(/^https?:\/\//, '')}</span>
                  </button>
                )}

                {/* Hover actions */}
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                  {!item.link && (
                    <button
                      type="button"
                      onClick={() => {
                        setShowLinkInput(showLinkInput === item.id ? null : item.id);
                        setShowEmojiPicker(null);
                        setTimeout(() => linkInputFieldRefs.current[item.id]?.focus(), 0);
                      }}
                      className="p-1 text-gray-400 hover:text-blue-500 transition-colors rounded"
                      title="Add link"
                    >
                      <LinkIcon size={12} />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => removeItem(item.id)}
                    className="p-1 text-gray-300 hover:text-red-400 transition-colors rounded"
                    title="Remove"
                  >
                    <X size={12} />
                  </button>
                </div>
              </div>
            </div>

            {/* Link input row */}
            {showLinkInput === item.id && (
              <div ref={linkInputRef} className="flex items-center gap-2 pl-12 pr-3 pb-2">
                <div className="flex-1 flex items-center gap-2 bg-gray-50 shadow-inner rounded-lg px-3 py-1.5 border border-gray-100">
                  <LinkIcon size={11} className="text-gray-400 shrink-0" />
                  <input
                    ref={(el) => { linkInputFieldRefs.current[item.id] = el; }}
                    type="url"
                    value={item.link || ''}
                    onChange={(e) => updateItemLink(item.id, e.target.value)}
                    placeholder="https://..."
                    className="flex-1 text-xs text-gray-600 bg-transparent border-none outline-none placeholder:text-gray-300"
                    autoFocus
                  />
                  {item.link && (
                    <button
                      type="button"
                      onClick={() => { updateItemLink(item.id, ''); setShowLinkInput(null); }}
                      className="text-[10px] text-gray-400 hover:text-red-400 transition-colors shrink-0"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}

        {/* Add button */}
        <button
          type="button"
          onClick={addItem}
          className="flex items-center gap-2 w-full px-4 py-2.5 text-sm text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-colors rounded-b-xl border-t border-gray-100"
        >
          <Plus size={13} className="text-blue-400 shrink-0" />
          Add learning objective
        </button>
      </div>

      {error && (
        <p className="text-xs text-red-500 px-1">{error}</p>
      )}
    </div>
  );
};

export default memo(LearningItemsList);
