import FormLayout, {
  ButtonBlack,
  Flex,
  FormField,
  FormLabel,
  FormMessage,
  Input,
} from '@components/StyledElements/Form/Form'
import React, { useState } from 'react'
import * as Form from '@radix-ui/react-form'
import BarLoader from 'react-spinners/BarLoader'
import { Youtube } from 'lucide-react'

interface ExternalVideoObject {
  name: string
  type: string
  uri: string
  chapter_id: string
}

function VideoModal({
  submitFileActivity,
  submitExternalVideo,
  chapterId,
  course,
}: any) {
  const [video, setVideo] = React.useState(null) as any
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [name, setName] = React.useState('')
  const [youtubeUrl, setYoutubeUrl] = React.useState('')
  const [selectedView, setSelectedView] = React.useState('file') as any

  const handleVideoChange = (event: React.ChangeEvent<any>) => {
    setVideo(event.target.files[0])
  }

  const handleNameChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setName(event.target.value)
  }

  const handleYoutubeUrlChange = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    setYoutubeUrl(event.target.value)
  }

  const handleSubmit = async (e: any) => {
    e.preventDefault()
    setIsSubmitting(true)

    if (selectedView === 'file') {
      let status = await submitFileActivity(
        video,
        'video',
        {
          name: name,
          chapter_id: chapterId,
          activity_type: 'TYPE_VIDEO',
          activity_sub_type: 'SUBTYPE_VIDEO_HOSTED',
          published_version: 1,
          version: 1,
          course_id: course.id,
        },
        chapterId
      )

      setIsSubmitting(false)
    }
    if (selectedView === 'youtube') {
      let external_video_object: ExternalVideoObject = {
        name,
        type: 'youtube',
        uri: youtubeUrl,
        chapter_id: chapterId,
      }

      let status = await submitExternalVideo(
        external_video_object,
        'activity',
        chapterId
      )
      setIsSubmitting(false)
    }
  }

  /* TODO : implement some sort of progress bar for file uploads, it is not possible yet because i'm not using axios.
   and the actual upload isn't happening here anyway, it's in the submitFileActivity function */

  return (  
    <FormLayout onSubmit={handleSubmit}>
      <FormField name="video-activity-name">
        <Flex css={{ alignItems: 'baseline', justifyContent: 'space-between' }}>
          <FormLabel>Video name</FormLabel>
          <FormMessage match="valueMissing">
            Please provide a name for your video activity
          </FormMessage>
        </Flex>
        <Form.Control asChild>
          <Input onChange={handleNameChange} type="text" required />
        </Form.Control>
      </FormField>
      <div className="flex flex-col rounded-md bg-gray-50 outline-dashed outline-gray-200">
        <div className="">
          <div className="flex m-4 justify-center space-x-2 mb-0">
            <div
              onClick={() => {
                setSelectedView('file')
              }}
              className="rounded-full bg-slate-900 text-zinc-50 py-2 px-4 text-sm drop-shadow-md hover:cursor-pointer hover:bg-slate-700 "
            >
              Video upload
            </div>
            <div
              onClick={() => {
                setSelectedView('youtube')
              }}
              className="rounded-full bg-slate-900 text-zinc-50 py-2 px-4 text-sm drop-shadow-md hover:cursor-pointer hover:bg-slate-700"
            >
              YouTube Video
            </div>
          </div>
          {selectedView === 'file' && (
            <div className="p-4 justify-center m-auto align-middle">
              <FormField name="video-activity-file">
                <Flex
                  css={{
                    alignItems: 'baseline',
                    justifyContent: 'space-between',
                  }}
                >
                  <FormLabel>Video file</FormLabel>
                  <FormMessage match="valueMissing">
                    Please provide a video for your activity
                  </FormMessage>
                </Flex>
                <Form.Control asChild>
                  <input type="file" onChange={handleVideoChange} required />
                </Form.Control>
              </FormField>
            </div>
          )}
          {selectedView === 'youtube' && (
            <div className="p-4 justify-center m-auto align-middle">
              <FormField name="video-activity-file">
                <Flex
                  css={{
                    alignItems: 'baseline',
                    justifyContent: 'space-between',
                  }}
                >
                  <FormLabel className="flex justify-center align-middle">
                    <Youtube className="m-auto pr-1" />
                    <span className="flex">YouTube URL</span>
                  </FormLabel>
                  <FormMessage match="valueMissing">
                    Please provide a video for your activity
                  </FormMessage>
                </Flex>
                <Form.Control asChild>
                  <Input
                    className="bg-white"
                    onChange={handleYoutubeUrlChange}
                    type="text"
                    required
                  />
                </Form.Control>
              </FormField>
            </div>
          )}
        </div>
      </div>

      <Flex css={{ marginTop: 25, justifyContent: 'flex-end' }}>
        <Form.Submit asChild>
          <ButtonBlack
            className="bg-black"
            type="submit"
            css={{ marginTop: 10 }}
          >
            {isSubmitting ? (
              <BarLoader
                cssOverride={{ borderRadius: 60 }}
                width={60}
                color="#ffffff"
              />
            ) : (
              'Create activity'
            )}
          </ButtonBlack>
        </Form.Submit>
      </Flex>
    </FormLayout>
  )
}

export default VideoModal
