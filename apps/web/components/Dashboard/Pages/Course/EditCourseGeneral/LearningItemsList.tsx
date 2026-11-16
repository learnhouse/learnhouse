import React, { useState, useEffect, useRef, memo, useCallback, useMemo, lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, X, Link as LinkIcon, ArrowSquareOut, DotsSixVertical } from '@phosphor-icons/react'
import { useColorScheme } from '@components/Contexts/ColorSchemeContext'
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

const parseItems = (value: string): LearningItem[] => {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.filter((it): it is LearningItem => it && typeof it === 'object' && typeof it.id === 'string');
    }
  } catch {
    // fall through
  }
  return [];
};

const newId = () => `l_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

const LearningItemsList = ({ value, onChange, error }: LearningItemsListProps) => {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  // Fully controlled: items are always derived from `value`.
  // Tab switches and remounts stay in sync without a local shadow copy.
  const items = useMemo(() => parseItems(value), [value]);

  const [showEmojiPicker, setShowEmojiPicker] = useState<string | null>(null);
  const [expandedLink, setExpandedLink] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);

  const pickerRef = useRef<HTMLDivElement>(null);
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const linkInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const commit = useCallback((next: LearningItem[]) => {
    onChange(JSON.stringify(next));
  }, [onChange]);

  const addItem = useCallback(() => {
    const id = newId();
    commit([...items, { id, text: '', emoji: '📝' }]);
    setTimeout(() => inputRefs.current[id]?.focus(), 0);
  }, [items, commit]);

  const removeItem = useCallback((id: string) => {
    commit(items.filter(it => it.id !== id));
  }, [items, commit]);

  const updateText = useCallback((id: string, text: string) => {
    commit(items.map(it => it.id === id ? { ...it, text } : it));
  }, [items, commit]);

  const updateEmoji = useCallback((id: string, emoji: string) => {
    commit(items.map(it => it.id === id ? { ...it, emoji } : it));
    setShowEmojiPicker(null);
    setTimeout(() => inputRefs.current[id]?.focus(), 0);
  }, [items, commit]);

  const updateLink = useCallback((id: string, link: string) => {
    commit(items.map(it => it.id === id ? { ...it, link } : it));
  }, [items, commit]);

  const clearLink = useCallback((id: string) => {
    commit(items.map(it => it.id === id ? { ...it, link: '' } : it));
    setExpandedLink(null);
  }, [items, commit]);

  // Close emoji picker when clicking outside
  useEffect(() => {
    if (!showEmojiPicker) return;
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowEmojiPicker(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showEmojiPicker]);

  // Drag and drop reordering
  const onDragStart = (id: string) => (e: React.DragEvent) => {
    setDragId(id);
    e.dataTransfer.effectAllowed = 'move';
  };
  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };
  const onDrop = (targetId: string) => (e: React.DragEvent) => {
    e.preventDefault();
    if (!dragId || dragId === targetId) { setDragId(null); return; }
    const from = items.findIndex(it => it.id === dragId);
    const to = items.findIndex(it => it.id === targetId);
    if (from === -1 || to === -1) { setDragId(null); return; }
    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    commit(next);
    setDragId(null);
  };

  const isEmpty = items.length === 0;

  return (
    <div className="space-y-1.5">
      <div className="rounded-xl ring-1 ring-inset ring-neutral-200 bg-white divide-y divide-neutral-100">
        {isEmpty && (
          <div className="px-4 py-8 text-center">
            <div className="text-sm font-medium text-neutral-500 mb-1">{t('dashboard.courses.general.learning_items.empty_title')}</div>
            <div className="text-xs text-neutral-400">{t('dashboard.courses.general.learning_items.empty_hint')}</div>
          </div>
        )}

        {items.map((item) => {
          const isDragging = dragId === item.id;
          return (
            <div
              key={item.id}
              className={`group relative ${isDragging ? 'opacity-40' : ''}`}
              onDragOver={onDragOver}
              onDrop={onDrop(item.id)}
            >
              <div className="flex items-center gap-2 px-2.5 py-2">
                {/* Drag handle */}
                <div
                  draggable
                  onDragStart={onDragStart(item.id)}
                  onDragEnd={() => setDragId(null)}
                  className="shrink-0 text-neutral-300 hover:text-neutral-500 cursor-grab active:cursor-grabbing p-0.5"
                  title={t('library.sort.drag_to_reorder')}
                >
                  <DotsSixVertical size={14} />
                </div>

                {/* Emoji button */}
                <div className="relative shrink-0">
                  <button
                    type="button"
                    onClick={() => setShowEmojiPicker(showEmojiPicker === item.id ? null : item.id)}
                    className="w-8 h-8 flex items-center justify-center text-xl leading-none rounded-lg hover:bg-neutral-100 transition-colors select-none"
                    title={t('dashboard.courses.general.learning_items.change_emoji')}
                  >
                    {item.emoji}
                  </button>
                  {showEmojiPicker === item.id && (
                    <div ref={pickerRef} className="absolute z-50 top-9 start-0">
                      <Suspense fallback={
                        <div className="p-3 text-xs text-neutral-400 bg-white rounded-xl nice-shadow w-[280px]">
                          {t('common.loading')}
                        </div>
                      }>
                        <Picker
                          onEmojiSelect={(e: any) => updateEmoji(item.id, e.native)}
                          theme={colorScheme}
                          previewPosition="none"
                          searchPosition="top"
                          maxFrequentRows={0}
                          autoFocus={false}
                        />
                      </Suspense>
                    </div>
                  )}
                </div>

                {/* Text input */}
                <input
                  ref={(el) => { inputRefs.current[item.id] = el; }}
                  type="text"
                  value={item.text}
                  onChange={(e) => updateText(item.id, e.target.value)}
                  placeholder={t('dashboard.courses.general.learning_items.placeholder')}
                  className="flex-1 min-w-0 text-sm text-neutral-800 bg-transparent border-none outline-none placeholder:text-neutral-400 py-1"
                />

                {/* Link chip (when link is set) */}
                {item.link && expandedLink !== item.id && (
                  <button
                    type="button"
                    onClick={() => setExpandedLink(item.id)}
                    className="flex items-center gap-1 text-[11px] font-semibold text-sky-700 bg-sky-50 hover:bg-sky-100 px-2 py-1 rounded-full shrink-0 transition-colors"
                    title={item.link}
                  >
                    <ArrowSquareOut size={10} />
                    <span className="max-w-[96px] truncate">{item.link.replace(/^https?:\/\//, '')}</span>
                  </button>
                )}

                {/* Action buttons, always visible but muted */}
                <div className="flex items-center gap-0.5 shrink-0">
                  {!item.link && (
                    <button
                      type="button"
                      onClick={() => {
                        setExpandedLink(expandedLink === item.id ? null : item.id);
                        setTimeout(() => linkInputRefs.current[item.id]?.focus(), 0);
                      }}
                      className="p-1.5 text-neutral-300 hover:text-neutral-700 hover:bg-neutral-100 rounded-lg transition-colors"
                      title={t('dashboard.courses.general.learning_items.add_link')}
                    >
                      <LinkIcon size={13} />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => removeItem(item.id)}
                    className="p-1.5 text-neutral-300 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                    title={t('boards.members.remove')}
                  >
                    <X size={13} />
                  </button>
                </div>
              </div>

              {/* Inline link editor */}
              {expandedLink === item.id && (
                <div className="px-12 pb-2.5 -mt-0.5">
                  <div className="flex items-center gap-2 bg-neutral-50 rounded-lg px-2.5 py-1.5 ring-1 ring-inset ring-neutral-200">
                    <LinkIcon size={12} className="text-neutral-400 shrink-0" />
                    <input
                      ref={(el) => { linkInputRefs.current[item.id] = el; }}
                      type="url"
                      value={item.link || ''}
                      onChange={(e) => updateLink(item.id, e.target.value)}
                      onBlur={() => { if (!item.link) setExpandedLink(null); }}
                      placeholder="https://..."
                      className="flex-1 text-xs text-neutral-800 bg-transparent border-none outline-none placeholder:text-neutral-400"
                      autoFocus
                    />
                    {item.link ? (
                      <button
                        type="button"
                        onClick={() => clearLink(item.id)}
                        className="text-[11px] font-medium text-neutral-400 hover:text-rose-600 transition-colors shrink-0"
                      >
                        {t('boards.members.remove')}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setExpandedLink(null)}
                        className="text-[11px] font-medium text-neutral-400 hover:text-neutral-700 transition-colors shrink-0"
                      >
                        {t('common.close')}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}

        <button
          type="button"
          onClick={addItem}
          className="flex items-center gap-2 w-full px-4 py-2.5 text-sm font-semibold text-neutral-500 hover:text-neutral-900 hover:bg-neutral-50 transition-colors rounded-b-xl"
        >
          <Plus size={14} className="shrink-0" />
          {t('dashboard.courses.general.learning_items.add')}
        </button>
      </div>

      {error && (
        <p className="text-xs font-medium text-rose-600 px-1">{error}</p>
      )}
    </div>
  );
};

export default memo(LearningItemsList);
