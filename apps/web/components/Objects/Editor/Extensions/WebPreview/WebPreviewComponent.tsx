import React, { useState, useEffect, useRef } from 'react';
import { NodeViewWrapper } from '@tiptap/react';
import { Globe, Edit2, Save, X, AlignLeft, AlignCenter, AlignRight, Trash } from 'lucide-react';
import { useEditorProvider } from '@components/Contexts/Editor/EditorContext';
import { getUrlPreview } from '@services/courses/activities';

interface WebPreviewProps {
  node: any;
  updateAttributes: (attrs: any) => void;
  extension: any;
  deleteNode?: () => void;
}

const ALIGNMENTS = [
  { value: 'left', label: <AlignLeft size={16} /> },
  { value: 'center', label: <AlignCenter size={16} /> },
  { value: 'right', label: <AlignRight size={16} /> },
];

const WebPreviewComponent: React.FC<WebPreviewProps> = ({ node, updateAttributes, deleteNode }) => {
  const [inputUrl, setInputUrl] = useState(node.attrs.url || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(!node.attrs.url);
  const inputRef = useRef<HTMLInputElement>(null);
  const editorState = useEditorProvider && useEditorProvider();
  let isEditable = true;
  if (editorState) {
    isEditable = (editorState as any).isEditable;
  }

  const previewData = {
    title: node.attrs.title,
    description: node.attrs.description,
    og_image: node.attrs.og_image,
    favicon: node.attrs.favicon,
    og_type: node.attrs.og_type,
    og_url: node.attrs.og_url,
    url: node.attrs.url,
  };

  const alignment = node.attrs.alignment || 'left';
  const hasPreview = !!previewData.title;

  const [buttonLabel, setButtonLabel] = useState(node.attrs.buttonLabel || 'Visit Site');
  const [showButton, setShowButton] = useState(node.attrs.showButton !== false);

  const fetchPreview = async (url: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await getUrlPreview(url);
      if (!res) throw new Error('Failed to fetch preview');
      const data = res;
      updateAttributes({ ...data, url });
      setEditing(false);
    } catch (err: any) {
      setError(err.message || 'Error fetching preview');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (node.attrs.url && !hasPreview) {
      fetchPreview(node.attrs.url);
    }
    // eslint-disable-next-line
  }, []);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
    }
  }, [editing]);

  useEffect(() => {
    setButtonLabel(node.attrs.buttonLabel || 'Visit Site');
    setShowButton(!!node.attrs.showButton);
  }, [node.attrs.buttonLabel, node.attrs.showButton]);

  const handleAlignmentChange = (value: string) => {
    updateAttributes({ alignment: value });
  };

  const handleEdit = () => {
    setEditing(true);
    setInputUrl(node.attrs.url || '');
  };

  const handleSaveEdit = () => {
    if (inputUrl && inputUrl !== node.attrs.url) {
      fetchPreview(inputUrl);
    } else {
      setEditing(false);
    }
    updateAttributes({ buttonLabel, showButton });
  };

  const handleCancelEdit = () => {
    setEditing(false);
    setInputUrl(node.attrs.url || '');
    setError(null);
  };

  const handleDelete = () => {
    if (typeof deleteNode === 'function') {
      deleteNode();
    } else {
      updateAttributes({ url: null, title: null, description: null, og_image: null, favicon: null, og_type: null, og_url: null });
    }
  };

  // Compute alignment class for CardWrapper
  let alignClass = 'justify-start';
  if (alignment === 'center') alignClass = 'justify-center';
  else if (alignment === 'right') alignClass = 'justify-end';

  return (
    <NodeViewWrapper className="web-preview-block relative">
      <div className={`flex w-full ${alignClass}`}> {/* CardWrapper */}
        <div className="bg-white nice-shadow rounded-xl max-w-[420px] min-w-[260px] my-2 px-6 pt-6 pb-4 relative "> {/* PreviewCard */}
          {/* Floating edit and delete buttons (only if not editing and isEditable) */}
          {isEditable && !editing && (
            <div className="flex flex-col gap-2 absolute -top-3 -right-3 z-20">
              <button
                className="flex items-center justify-center bg-yellow-50 text-yellow-700 border border-yellow-200 shadow-md rounded-md p-1.5 hover:bg-yellow-100"
                onClick={handleEdit}
                title="Edit URL"
                type="button"
              >
                <Edit2 size={16} />
              </button>
              <button
                className="flex items-center justify-center bg-red-50 text-red-700 border border-red-200 shadow-md rounded-md p-1.5 hover:bg-red-100"
                onClick={handleDelete}
                title="Delete Card"
                type="button"
              >
                <Trash size={16} />
              </button>
            </div>
          )}
          {/* Only show edit bar when editing */}
          {isEditable && editing && (
            <>
              <div className="flex items-center gap-2 mb-2"> {/* EditBar */}
                <Globe size={18} style={{ opacity: 0.7, marginRight: 4 }} />
                <input
                  ref={inputRef}
                  type="text"
                  placeholder="Enter website URL..."
                  value={inputUrl}
                  onChange={e => setInputUrl(e.target.value)}
                  disabled={loading}
                  onKeyDown={e => { if (e.key === 'Enter') handleSaveEdit(); }}
                  className="flex-1 border border-gray-200 rounded-md px-2.5 py-1.5 text-sm font-sans focus:outline-none focus:border-gray-400"
                />
                <button
                  onClick={handleSaveEdit}
                  disabled={loading || !inputUrl}
                  title="Save"
                  type="button"
                  className="flex items-center justify-center bg-gray-100 border-none rounded-md p-1 cursor-pointer text-gray-700 transition-colors duration-150 hover:bg-gray-200 aria-pressed:bg-blue-600 aria-pressed:text-white disabled:opacity-50"
                  aria-pressed={false}
                >
                  {loading ? <Save size={16} /> : <Save size={16} />}
                </button>
                <button
                  onClick={handleCancelEdit}
                  title="Cancel"
                  type="button"
                  className="flex items-center justify-center bg-gray-100 border-none rounded-md p-1 cursor-pointer text-gray-700 transition-colors duration-150 hover:bg-gray-200"
                >
                  <X size={16} />
                </button>
              </div>
              {/* Button toggle and label input */}
              <div className="flex items-center gap-2 mb-2">
                <label className="flex items-center gap-1 text-sm">
                  <input
                    type="checkbox"
                    checked={showButton}
                    onChange={e => {
                      setShowButton(e.target.checked);
                      updateAttributes({ showButton: e.target.checked });
                    }}
                    className="accent-blue-600"
                  />
                  Show button
                </label>
                {showButton && (
                  <input
                    type="text"
                    value={buttonLabel}
                    onChange={e => {
                      setButtonLabel(e.target.value);
                      updateAttributes({ buttonLabel: e.target.value });
                    }}
                    placeholder="Button label"
                    className="border border-gray-200 rounded-md px-2 py-1 text-sm font-sans focus:outline-none focus:border-gray-400"
                    style={{ minWidth: 100 }}
                  />
                )}
              </div>
            </>
          )}
          {error && <div className="text-red-600 text-xs mt-2">{error}</div>}
          {/* Only show preview card when not editing */}
          {hasPreview && !editing && (
            <>
              <a
                href={previewData.url}
                target="_blank"
                rel="noopener noreferrer"
                className="no-underline hover:no-underline focus:no-underline active:no-underline"
                style={{ textDecoration: 'none', borderBottom: 'none' }}
              >
                {previewData.og_image && (
                  <div className="-mt-6 -mx-6 mb-0 rounded-t-xl overflow-hidden">
                    <img
                      src={previewData.og_image}
                      alt="preview"
                      className="w-full h-40 object-cover block"
                    />
                  </div>
                )}
                <div className="pt-4 pb-2">
                  <a
                    href={previewData.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="no-underline hover:no-underline focus:no-underline active:no-underline"
                    style={{ textDecoration: 'none', borderBottom: 'none' }}
                  >
                    <span
                      className="font-semibold text-lg text-[#232323] mb-1.5 leading-tight no-underline hover:no-underline focus:no-underline active:no-underline"
                      style={{ textDecoration: 'none', borderBottom: 'none' }}
                    >
                      {previewData.title}
                    </span>
                    <span
                      className="block text-gray-700 text-sm mb-3 leading-snug no-underline hover:no-underline focus:no-underline active:no-underline"
                      style={{ textDecoration: 'none', borderBottom: 'none' }}
                    >
                      {previewData.description}
                    </span>
                  </a>
                </div>
              </a>
              <div className="flex items-center mt-0 pt-2 border-t border-gray-100">
                {previewData.favicon && (
                  <img
                    src={previewData.favicon}
                    alt="favicon"
                    className="w-[18px] h-[18px] mr-2 rounded bg-gray-100"
                  />
                )}
                <span className="text-gray-500 text-xs truncate">{previewData.url}</span>
              </div>
              {showButton && previewData.url && (
                <a
                  href={previewData.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block w-full mt-4 rounded-xl bg-white nice-shadow text-[16px] font-semibold text-purple-600 py-2.5 px-4 text-center no-underline hover:bg-gray-50 hover:shadow-lg transition-all [&:not(:hover)]:text-black [&:hover]:text-black"
                  style={{ textDecoration: 'none', color: 'black' }}
                >
                  {buttonLabel || 'Visit Site'}
                </a>
              )}
            </>
          )}
          {isEditable && !editing && (
            <div className="flex items-center gap-1 mt-2"> {/* AlignmentBar */}
              <span className="text-xs text-gray-500 mr-1">Align:</span>
              {ALIGNMENTS.map(opt => (
                <button
                  key={opt.value}
                  aria-pressed={alignment === opt.value}
                  onClick={() => handleAlignmentChange(opt.value)}
                  title={`Align ${opt.value}`}
                  type="button"
                  className={`flex items-center justify-center border transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-blue-300 p-1.5 rounded-full text-gray-600
                    ${alignment === opt.value
                      ? 'bg-gray-600 text-white border-gray-600 hover:bg-gray-700'
                      : 'bg-white border-gray-200 hover:bg-gray-100'}
                  `}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </NodeViewWrapper>
  );
};

export default WebPreviewComponent; 