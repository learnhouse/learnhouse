import { NodeViewWrapper } from '@tiptap/react'
import React, { useEffect } from 'react'
import styled from 'styled-components'
import { AlertTriangle, FileText, Download } from 'lucide-react'
import { uploadNewPDFFile } from '../../../../../services/blocks/Pdf/pdf'
import { getActivityBlockMediaDirectory } from '@services/media/media'
import { useOrg } from '@components/Contexts/OrgContext'
import { useCourse } from '@components/Contexts/CourseContext'
import { useEditorProvider } from '@components/Contexts/Editor/EditorContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { FileUploadBlock, FileUploadBlockButton, FileUploadBlockInput } from '../../FileUploadBlock'
import { constructAcceptValue } from '@/lib/constants';

const SUPPORTED_FILES = constructAcceptValue(['pdf'])

function PDFBlockComponent(props: any) {
  const org = useOrg() as any
  const course = useCourse() as any
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token;
  const [pdf, setPDF] = React.useState(null)
  const [isLoading, setIsLoading] = React.useState(false)
  const [blockObject, setblockObject] = React.useState(
    props.node.attrs.blockObject
  )
  const fileId = blockObject
    ? `${blockObject.content.file_id}.${blockObject.content.file_format}`
    : null
  const editorState = useEditorProvider() as any
  const isEditable = editorState.isEditable

  const handlePDFChange = (event: React.ChangeEvent<any>) => {
    setPDF(event.target.files[0])
  }

  const handleSubmit = async (e: any) => {
    e.preventDefault()
    setIsLoading(true)
    let object = await uploadNewPDFFile(
      pdf,
      props.extension.options.activity.activity_uuid, access_token
    )
    setIsLoading(false)
    setblockObject(object)
    props.updateAttributes({
      blockObject: object,
    })
  }

  const handleDownload = () => {
    if (!fileId) return;
    
    const pdfUrl = getActivityBlockMediaDirectory(
      org?.org_uuid,
      course?.courseStructure.course_uuid,
      props.extension.options.activity.activity_uuid,
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

  useEffect(() => { }, [course, org])

  return (
    <NodeViewWrapper className="block-pdf">
      <FileUploadBlock isEditable={isEditable} isLoading={isLoading} isEmpty={!blockObject} Icon={FileText}>
        <FileUploadBlockInput onChange={handlePDFChange} accept={SUPPORTED_FILES} />
        <FileUploadBlockButton onClick={handleSubmit} disabled={!pdf}/>
      </FileUploadBlock>
      
      {blockObject && (
        <BlockPDF>
          <div className="relative">
            <iframe
              className="shadow-sm rounded-lg h-96 w-full object-scale-down bg-black"
              src={`${getActivityBlockMediaDirectory(
                org?.org_uuid,
                course?.courseStructure.course_uuid,
                props.extension.options.activity.activity_uuid,
                blockObject.block_uuid,
                blockObject ? fileId : ' ',
                'pdfBlock'
              )}`}
            />
            {!isEditable && (
              <button
                onClick={handleDownload}
                className="absolute top-2 right-2 p-2 bg-black/50 hover:bg-black/70 rounded-full transition-colors"
                title="Download PDF"
              >
                <Download className="w-4 h-4 text-white" />
              </button>
            )}
          </div>
        </BlockPDF>
      )}
      {isLoading && (
        <div>
          <AlertTriangle color="#e1e0e0" size={50} />
        </div>
      )}
    </NodeViewWrapper>
  )
}

export default PDFBlockComponent

const BlockPDF = styled.div`
  display: flex;
  flex-direction: column;
  img {
    width: 100%;
    border-radius: 6px;
    height: 300px;
    // cover
    object-fit: cover;
  }
`
const PDFNotFound = styled.div``
