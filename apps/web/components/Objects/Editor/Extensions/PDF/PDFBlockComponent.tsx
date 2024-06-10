import { NodeViewWrapper } from '@tiptap/react'
import React, { useEffect } from 'react'
import styled from 'styled-components'
import { AlertTriangle, FileText, Loader } from 'lucide-react'
import { uploadNewPDFFile } from '../../../../../services/blocks/Pdf/pdf'
import { UploadIcon } from '@radix-ui/react-icons'
import { getActivityBlockMediaDirectory } from '@services/media/media'
import { useOrg } from '@components/Contexts/OrgContext'
import { useCourse } from '@components/Contexts/CourseContext'
import { useEditorProvider } from '@components/Contexts/Editor/EditorContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'

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

  useEffect(() => { }, [course, org])

  return (
    <NodeViewWrapper className="block-pdf">
      {!blockObject && (
        <BlockPDFWrapper
          className="flex items-center space-x-3 py-7 bg-gray-50 rounded-xl text-gray-900 px-3 border-dashed border-gray-150 border-2"
          contentEditable={isEditable}
        >
          {isLoading ? (
            <Loader
              className="animate-spin animate-pulse text-gray-200"
              size={50}
            />
          ) : (
            <>
              <div>
                <FileText className="text-gray-200" size={50} />
              </div>
              <input
                className="p-3 rounded-lg file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 hover:file:cursor-pointer  file:bg-gray-200 cursor-pointer file:text-gray-500"
                onChange={handlePDFChange}
                type="file"
                name=""
                id=""
              />
              <button
                className="p-2 px-3 bg-gray-200 rounded-lg text-gray-500 hover:bg-gray-300 transition space-x-2 items-center flex"
                onClick={handleSubmit}
              >
                <UploadIcon></UploadIcon>
                <p>Submit</p>
              </button>
            </>
          )}
        </BlockPDFWrapper>
      )}
      {blockObject && (
        <BlockPDF>
          <iframe
            className="shadow rounded-lg h-96 w-full object-scale-down bg-black"
            src={`${getActivityBlockMediaDirectory(
              org?.org_uuid,
              course?.courseStructure.course_uuid,
              props.extension.options.activity.activity_uuid,
              blockObject.block_uuid,
              blockObject ? fileId : ' ',
              'pdfBlock'
            )}`}
          />
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

const BlockPDFWrapper = styled.div`
  // center
  align-items: center;
  justify-content: center;
  text-align: center;
  font-size: 14px;
`

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
