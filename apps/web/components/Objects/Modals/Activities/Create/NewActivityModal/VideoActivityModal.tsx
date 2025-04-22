import FormLayout, {
  ButtonBlack,
  Flex,
  FormField,
  FormLabel,
  FormMessage,
  Input,
} from '@components/Objects/StyledElements/Form/Form'
import React, { useState } from 'react'
import * as Form from '@radix-ui/react-form'
import BarLoader from 'react-spinners/BarLoader'
import { Youtube, Upload } from 'lucide-react'
import { constructAcceptValue } from '@/lib/constants'

const SUPPORTED_FILES = constructAcceptValue(['mp4', 'webm'])

interface VideoDetails {
  startTime: number
  endTime: number | null
  autoplay: boolean
  muted: boolean
}

interface ExternalVideoObject {
  name: string
  type: string
  uri: string
  chapter_id: string
  details: VideoDetails
}

function VideoModal({
  submitFileActivity,
  submitExternalVideo,
  chapterId,
  course,
}: any) {
  const [video, setVideo] = React.useState<File | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [name, setName] = React.useState('')
  const [youtubeUrl, setYoutubeUrl] = React.useState('')
  const [selectedView, setSelectedView] = React.useState<'file' | 'youtube'>('file')
  const [videoDetails, setVideoDetails] = React.useState<VideoDetails>({
    startTime: 0,
    endTime: null,
    autoplay: false,
    muted: false
  })

  const handleVideoChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files?.[0]) {
      setVideo(event.target.files[0])
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)

    try {
      if (selectedView === 'file' && video) {
        await submitFileActivity(
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
            details: videoDetails
          },
          chapterId
        )
      }
      
      if (selectedView === 'youtube') {
        const external_video_object: ExternalVideoObject = {
          name,
          type: 'youtube',
          uri: youtubeUrl,
          chapter_id: chapterId,
          details: videoDetails
        }

        await submitExternalVideo(
          external_video_object,
          'activity',
          chapterId
        )
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  const VideoSettingsForm = () => (
    <div className="space-y-4 mt-4 p-4 bg-gray-50 rounded-lg">
      <h3 className="font-medium text-gray-900 mb-3">Video Settings</h3>
      <div className="grid grid-cols-2 gap-4">
        <FormField name="start-time">
          <FormLabel>Start Time (seconds)</FormLabel>
          <Form.Control asChild>
            <Input
              type="number"
              min="0"
              value={videoDetails.startTime}
              onChange={(e) => setVideoDetails({
                ...videoDetails,
                startTime: Math.max(0, parseInt(e.target.value) || 0)
              })}
              placeholder="0"
            />
          </Form.Control>
        </FormField>

        <FormField name="end-time">
          <FormLabel>End Time (seconds, optional)</FormLabel>
          <Form.Control asChild>
            <Input
              type="number"
              min={videoDetails.startTime + 1}
              value={videoDetails.endTime || ''}
              onChange={(e) => setVideoDetails({
                ...videoDetails,
                endTime: e.target.value ? parseInt(e.target.value) : null
              })}
              placeholder="Leave empty for full duration"
            />
          </Form.Control>
        </FormField>
      </div>

      <div className="flex items-center space-x-6 mt-4">
        <label className="flex items-center space-x-2">
          <input
            type="checkbox"
            checked={videoDetails.autoplay}
            onChange={(e) => setVideoDetails({
              ...videoDetails,
              autoplay: e.target.checked
            })}
            className="rounded border-gray-300 text-black focus:ring-black"
          />
          <span className="text-sm text-gray-700">Autoplay video</span>
        </label>

        <label className="flex items-center space-x-2">
          <input
            type="checkbox"
            checked={videoDetails.muted}
            onChange={(e) => setVideoDetails({
              ...videoDetails,
              muted: e.target.checked
            })}
            className="rounded border-gray-300 text-black focus:ring-black"
          />
          <span className="text-sm text-gray-700">Start muted</span>
        </label>
      </div>
    </div>
  )

  return (
    <FormLayout onSubmit={handleSubmit}>
      <FormField name="video-activity-name">
        <Flex css={{ alignItems: 'baseline', justifyContent: 'space-between' }}>
          <FormLabel>Activity Name</FormLabel>
          <FormMessage match="valueMissing">
            Please provide a name for your video activity
          </FormMessage>
        </Flex>
        <Form.Control asChild>
          <Input 
            value={name}
            onChange={(e) => setName(e.target.value)} 
            type="text" 
            required 
            placeholder="Enter activity name..."
          />
        </Form.Control>
      </FormField>

      <div className="mt-4 rounded-lg border border-gray-200">
        <div className="grid grid-cols-2 gap-0">
          <button
            type="button"
            onClick={() => setSelectedView('file')}
            className={`flex items-center justify-center p-4 gap-2 ${
              selectedView === 'file'
                ? 'bg-gray-100 border-b-2 border-black'
                : 'hover:bg-gray-50 border-b border-gray-200'
            }`}
          >
            <Upload size={18} />
            <span>Upload Video</span>
          </button>
          <button
            type="button"
            onClick={() => setSelectedView('youtube')}
            className={`flex items-center justify-center p-4 gap-2 ${
              selectedView === 'youtube'
                ? 'bg-gray-100 border-b-2 border-black'
                : 'hover:bg-gray-50 border-b border-gray-200'
            }`}
          >
            <Youtube size={18} />
            <span>YouTube Video</span>
          </button>
        </div>

        <div className="p-6">
          {selectedView === 'file' && (
            <div className="space-y-4">
              <FormField name="video-activity-file">
                <FormLabel>Video File</FormLabel>
                <div className="mt-2">
                  <input
                    type="file"
                    accept={SUPPORTED_FILES}
                    onChange={handleVideoChange}
                    required
                    className="w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-black file:text-white hover:file:bg-gray-800"
                  />
                </div>
              </FormField>
              <VideoSettingsForm />
            </div>
          )}

          {selectedView === 'youtube' && (
            <div className="space-y-4">
              <FormField name="youtube-url">
                <FormLabel>YouTube URL</FormLabel>
                <Form.Control asChild>
                  <Input
                    value={youtubeUrl}
                    onChange={(e) => setYoutubeUrl(e.target.value)}
                    type="text"
                    required
                    placeholder="https://youtube.com/watch?v=..."
                  />
                </Form.Control>
              </FormField>
              <VideoSettingsForm />
            </div>
          )}
        </div>
      </div>

      <Flex css={{ marginTop: 25, justifyContent: 'flex-end' }}>
        <Form.Submit asChild>
          <ButtonBlack type="submit" css={{ marginTop: 10 }}>
            {isSubmitting ? (
              <BarLoader
                cssOverride={{ borderRadius: 60 }}
                width={60}
                color="#ffffff"
              />
            ) : (
              'Create Activity'
            )}
          </ButtonBlack>
        </Form.Submit>
      </Flex>
    </FormLayout>
  )
}

export default VideoModal
