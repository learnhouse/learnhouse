import React, { useState, useEffect, useRef } from 'react';
import { NodeViewWrapper } from '@tiptap/react';
import { Globe, Edit2, Save, X, AlignLeft, AlignCenter, AlignRight, Trash } from 'lucide-react';
import { useEditorProvider } from '@components/Contexts/Editor/EditorContext';
import { getUrlPreview } from '@services/courses/activities';
import Modal from '@components/Objects/StyledElements/Modal/Modal';
import { Input } from '@components/ui/input';
import { Label } from '@components/ui/label';
import { Checkbox } from '@components/ui/checkbox';
import { Button } from '@components/ui/button';
import toast from 'react-hot-toast';

interface EditorContext {
  isEditable: boolean;
  [key: string]: any;
}

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
  const editorContext = useEditorProvider() as EditorContext;
  const isEditable = editorContext?.isEditable ?? true;

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
  const [openInPopup, setOpenInPopup] = useState(node.attrs.openInPopup || false);
  const [popupOpen, setPopupOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(!node.attrs.url);

  const fetchPreview = async (url: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await getUrlPreview(url);
      if (!res) throw new Error('Failed to fetch preview');
      const data = res;
      
      // Check if metadata is insufficient (only has basic fields like favicon/url but no title/description)
      const hasMinimalMetadata = !data.title && !data.description && !data.og_image;
      
      if (hasMinimalMetadata) {
        toast.error("Unable to get metadata from this website. The preview card may appear incomplete.", {
          duration: 4000,
        });
      }
      
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
    setOpenInPopup(!!node.attrs.openInPopup);
  }, [node.attrs.buttonLabel, node.attrs.showButton, node.attrs.openInPopup]);

  useEffect(() => {
    if (!node.attrs.url) {
      setEditing(true);
      setModalOpen(true);
    }
  }, [node.attrs.url]);

  const handleAlignmentChange = (value: string) => {
    updateAttributes({ alignment: value });
  };

  const handleEdit = () => {
    setEditing(true);
    setInputUrl(node.attrs.url || '');
    setModalOpen(true);
  };

  const handleSaveEdit = () => {
    if (inputUrl && inputUrl !== node.attrs.url) {
      fetchPreview(inputUrl);
    } else {
      setEditing(false);
      setModalOpen(false);
    }
    updateAttributes({ buttonLabel, showButton, openInPopup });
    setModalOpen(false);
  };

  const handleCancelEdit = () => {
    setEditing(false);
    setInputUrl(node.attrs.url || '');
    setError(null);
    setModalOpen(false);
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
      {/* Popup Modal for Embedded Website */}
      <Modal
        isDialogOpen={popupOpen}
        onOpenChange={setPopupOpen}
        dialogTitle={previewData.title || 'Website Preview'}
        minWidth="xl"
        minHeight="xl"
        dialogContent={
          <iframe
            src={previewData.url}
            title="Embedded Website Preview"
            className="w-full h-full border-0 bg-white"
            style={{ display: 'block', borderRadius: 0 }}
            allowFullScreen
          />
        }
      />
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
          {/* Modal for editing */}
          <Modal
            isDialogOpen={modalOpen}
            onOpenChange={(open) => {
              setModalOpen(open);
              if (!open) handleCancelEdit();
            }}
            dialogTitle="Edit Web Preview Card"
            dialogDescription="Update the website preview, button, and display options."
            minWidth="md"
            dialogContent={
              <form className="space-y-6" onSubmit={e => { e.preventDefault(); handleSaveEdit(); }}>
                <div className="space-y-2">
                  <Label htmlFor="web-url-input">Website URL</Label>
                  <Input
                    id="web-url-input"
                    ref={inputRef}
                    type="text"
                    placeholder="Enter website URL..."
                    value={inputUrl}
                    onChange={e => setInputUrl(e.target.value)}
                    disabled={loading}
                    autoFocus
                  />
                </div>
                <div className="space-y-2">
                  <Label>Button Options</Label>
                  <div className="flex flex-col gap-3  pt-3">
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="show-button"
                        checked={showButton}
                        onCheckedChange={checked => setShowButton(!!checked)}
                      />
                      <Label htmlFor="show-button" className="text-sm">Show button</Label>
                    </div>
                    {showButton && (
                      <>
                      <div className="flex items-center gap-2">
                          <Checkbox
                            id="open-in-popup"
                            checked={openInPopup}
                            onCheckedChange={checked => setOpenInPopup(!!checked)}
                          />
                          <Label htmlFor="open-in-popup" className="text-sm">Open in-app popup (might not work on all websites)</Label>
                        </div>
                        <div className="flex  gap-2 flex-col ">
                          <Label htmlFor="button-label" className="text-sm">Button label</Label>
                          <Input
                            id="button-label"
                            type="text"
                            value={buttonLabel}
                            onChange={e => setButtonLabel(e.target.value)}
                            placeholder="Button label"
                            className="w-36"
                          />
                        </div>
                        
                      </>
                    )}
                  </div>
                </div>
                <div className="space-y-">
                  <Label>Alignment</Label>
                  <div className="flex gap-2 pt-3">
                    {ALIGNMENTS.map(opt => (
                      <Button
                        key={opt.value}
                        type="button"
                        variant={alignment === opt.value ? 'default' : 'outline'}
                        size="sm"
                        aria-pressed={alignment === opt.value}
                        onClick={() => handleAlignmentChange(opt.value)}
                        className={`rounded-full px-2 py-1 ${alignment === opt.value ? 'bg-black text-white' : ''}`}
                      >
                        {opt.label}
                      </Button>
                    ))}
                  </div>
                </div>
                {error && <div className="text-red-600 text-xs mt-2">{error}</div>}
                <div className="flex justify-end gap-2 mt-2">
                  <Button type="button" variant="outline" onClick={handleCancelEdit}>
                    <span className="flex items-center"><X size={16} className="mr-1" /> Cancel</span>
                  </Button>
                  <Button type="submit" disabled={loading || !inputUrl}>
                    <span className="flex items-center"><Save size={16} className="mr-1" /> Save</span>
                  </Button>
                </div>
              </form>
            }
          />
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
                openInPopup ? (
                  <button
                    type="button"
                    className="block w-full mt-4 rounded-xl bg-black nice-shadow text-[16px] font-semibold text-white py-2.5 px-4 text-center no-underline hover:bg-gray-900 hover:shadow-lg transition-all"
                    style={{ textDecoration: 'none', color: 'white' }}
                    onClick={() => setPopupOpen(true)}
                  >
                    {buttonLabel || 'Visit Site'}
                  </button>
                ) : (
                  <a
                    href={previewData.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block w-full mt-4 rounded-xl bg-black nice-shadow text-[16px] font-semibold text-white py-2.5 px-4 text-center no-underline hover:bg-gray-900 hover:shadow-lg transition-all"
                    style={{ textDecoration: 'none', color: 'white' }}
                  >
                    {buttonLabel || 'Visit Site'}
                  </a>
                )
              )}
              {/* Alignment bar in view mode */}
              {isEditable && (
                <div className="flex flex-col items-center mt-4">
                  <div className="flex items-center gap-1"> {/* AlignmentBar */}
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
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </NodeViewWrapper>
  );
};

export default WebPreviewComponent; 