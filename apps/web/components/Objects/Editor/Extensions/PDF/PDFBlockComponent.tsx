import { NodeViewWrapper } from '@tiptap/react'
import React, { useEffect } from 'react'
import { FileText, Download, Expand, Upload, Loader2, AlertCircle } from 'lucide-react'
import toast from 'react-hot-toast'
import { uploadNewPDFFile } from '../../../../../services/blocks/Pdf/pdf'
import { getActivityBlockMediaDirectory } from '@services/media/media'
import { useOrg } from '@components/Contexts/OrgContext'
import { useCourse } from '@components/Contexts/CourseContext'
import { useEditorProvider } from '@components/Contexts/Editor/EditorContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { constructAcceptValue } from '@/lib/constants';
import Modal from '@components/Objects/StyledElements/Modal/Modal'

const SUPPORTED_FILES = constructAcceptValue(['pdf'])

function PDFBlockComponent(props: any) {
  const org = useOrg() as any
  const course = useCourse() as any
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token;
  const [pdf, setPDF] = React.useState<File | null>(null)
  const [isLoading, setIsLoading] = React.useState(false)
  const [blockObject, setblockObject] = React.useState(
    props.node.attrs.blockObject
  )
  const [isModalOpen, setIsModalOpen] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const fileId = blockObject
    ? `${blockObject.content.file_id}.${blockObject.content.file_format}`
    : null
  const editorState = useEditorProvider() as any
  const isEditable = editorState.isEditable

  const handlePDFChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) {
      setPDF(file)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!pdf) return
    setIsLoading(true)
    setError(null)
    try {
      let object = await uploadNewPDFFile(
        pdf,
        props.extension.options.activity.activity_uuid, access_token
      )
      setblockObject(object)
      props.updateAttributes({
        blockObject: object,
      })
      setPDF(null)
    } catch (err: any) {
      const errorMessage = err?.message || 'Failed to upload PDF. Please try again.'
      setError(errorMessage)
      toast.error(errorMessage)
    } finally {
      setIsLoading(false)
    }
  }

  const handleDownload = () => {
    if (!fileId) return;

    const pdfUrl = getActivityBlockMediaDirectory(
      org?.org_uuid,
      course?.courseStructure.course_uuid,
      blockObject.content.activity_uuid || props.extension.options.activity.activity_uuid,
      blockObject.block_uuid,
      fileId,
      'pdfBlock'
    );

    const link = document.createElement('a');
    link.href = pdfUrl || '';
    link.download = `document-${blockObject?.block_uuid || 'download'}.${blockObject?.content.file_format || 'pdf'}`;
    link.setAttribute('download', '');
    link.setAttribute('target', '_blank');
    link.setAttribute('rel', 'noopener noreferrer');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleExpand = () => {
    setIsModalOpen(true);
  };

  const pdfUrl = blockObject ? getActivityBlockMediaDirectory(
    org?.org_uuid,
    course?.courseStructure.course_uuid,
    blockObject.content.activity_uuid || props.extension.options.activity.activity_uuid,
    blockObject.block_uuid,
    fileId || '',
    'pdfBlock'
  ) : null;

  useEffect(() => { }, [course, org])

  // View mode without PDF
  if (!isEditable && !blockObject) {
    return (
      <NodeViewWrapper className="block-pdf">
        <div className="bg-neutral-50 rounded-xl px-5 py-4 nice-shadow">
          <div className="flex items-center justify-center gap-3 py-8 bg-white rounded-lg nice-shadow">
            <FileText className="text-neutral-300" size={32} />
            <p className="text-neutral-500">No PDF available</p>
          </div>
        </div>
      </NodeViewWrapper>
    )
  }

  // View mode with PDF
  if (!isEditable && blockObject && pdfUrl) {
    return (
      <>
        <NodeViewWrapper className="block-pdf">
          <div className="relative group">
            <iframe
              className="w-full h-96 rounded-lg nice-shadow bg-white"
              src={pdfUrl}
              title="PDF Document"
            />
            <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={handleExpand}
                className="p-2 outline-none bg-black/50 hover:bg-black/70 rounded-lg transition-colors"
                title="Expand PDF"
              >
                <Expand className="w-4 h-4 text-white" />
              </button>
              <button
                onClick={handleDownload}
                className="p-2 outline-none bg-black/50 hover:bg-black/70 rounded-lg transition-colors"
                title="Download PDF"
              >
                <Download className="w-4 h-4 text-white" />
              </button>
            </div>
          </div>
        </NodeViewWrapper>

        <Modal
          isDialogOpen={isModalOpen}
          onOpenChange={setIsModalOpen}
          dialogTitle="PDF Document"
          minWidth="xl"
          minHeight="xl"
          dialogContent={
            <div className="w-full h-[80vh]">
              <iframe
                className="w-full h-full rounded-lg shadow-lg border"
                src={pdfUrl}
                title="PDF Document"
              />
            </div>
          }
        />
      </>
    )
  }

  // Edit mode
  return (
    <>
      <NodeViewWrapper className="block-pdf">
        <div className="bg-neutral-50 rounded-xl px-5 py-4 transition-all ease-linear">
          {/* Header */}
          <div className="flex items-center gap-2 mb-3">
            <FileText className="text-neutral-400" size={16} />
            <span className="uppercase tracking-widest text-xs font-bold text-neutral-400">
              PDF Document
            </span>
          </div>

          {/* Upload Zone - shown when no PDF */}
          {!blockObject && (
            <form onSubmit={handleSubmit}>
              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-all border-neutral-200 bg-white hover:border-blue-400 hover:bg-blue-50/50"
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  onChange={handlePDFChange}
                  accept={SUPPORTED_FILES}
                  className="hidden"
                />
                {isLoading ? (
                  <div className="space-y-3">
                    <Loader2 className="w-8 h-8 animate-spin mx-auto text-blue-500" />
                    <p className="text-sm text-neutral-600">Uploading PDF...</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <Upload className="w-8 h-8 mx-auto text-neutral-400" />
                    <div>
                      <p className="text-sm font-medium text-neutral-700">
                        {pdf ? pdf.name : 'Drop your PDF here or click to browse'}
                      </p>
                      <p className="text-xs text-neutral-500 mt-1">
                        Supports PDF format
                      </p>
                    </div>
                  </div>
                )}
              </div>
              {pdf && (
                <div className="mt-3 flex justify-end">
                  <button
                    type="submit"
                    disabled={isLoading}
                    className="flex items-center gap-2 px-4 py-2 bg-neutral-700 hover:bg-neutral-800 text-white rounded-lg text-sm transition-colors disabled:opacity-50"
                  >
                    <Upload size={14} />
                    Upload PDF
                  </button>
                </div>
              )}
              {error && (
                <div className="mt-3 flex items-center gap-2 text-sm text-red-500 font-medium bg-red-50 rounded-lg p-3">
                  <AlertCircle size={16} />
                  {error}
                </div>
              )}
            </form>
          )}

          {/* PDF Preview */}
          {blockObject && pdfUrl && (
            <div className="relative">
              <iframe
                className="w-full h-96 rounded-lg nice-shadow bg-white"
                src={pdfUrl}
                title="PDF Document"
              />
              <div className="absolute top-2 right-2 flex gap-1">
                <button
                  onClick={handleExpand}
                  className="p-2 outline-none bg-black/50 hover:bg-black/70 rounded-lg transition-colors"
                  title="Expand PDF"
                >
                  <Expand className="w-4 h-4 text-white" />
                </button>
                <button
                  onClick={handleDownload}
                  className="p-2 outline-none bg-black/50 hover:bg-black/70 rounded-lg transition-colors"
                  title="Download PDF"
                >
                  <Download className="w-4 h-4 text-white" />
                </button>
              </div>
            </div>
          )}
        </div>
      </NodeViewWrapper>

      {blockObject && pdfUrl && (
        <Modal
          isDialogOpen={isModalOpen}
          onOpenChange={setIsModalOpen}
          dialogTitle="PDF Document"
          minWidth="xl"
          minHeight="xl"
          dialogContent={
            <div className="w-full h-[80vh]">
              <iframe
                className="w-full h-full rounded-lg shadow-lg border"
                src={pdfUrl}
                title="PDF Document"
              />
            </div>
          }
        />
      )}
    </>
  )
}

export default PDFBlockComponent
