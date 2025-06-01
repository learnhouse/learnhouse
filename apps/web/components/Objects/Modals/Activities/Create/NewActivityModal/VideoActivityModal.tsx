import {
  Button,
} from "@components/ui/button"
import {
  Input
} from "@components/ui/input"
import { Label } from "@components/ui/label"
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

  const VideoSettingsForm = () => {
    const convertToSeconds = (minutes: number, seconds: number) => {
      return minutes * 60 + seconds;
    };

    const convertFromSeconds = (totalSeconds: number) => {
      const minutes = Math.floor(totalSeconds / 60);
      const seconds = totalSeconds % 60;
      return { minutes, seconds };
    };

    const startTimeParts = convertFromSeconds(videoDetails.startTime);
    const endTimeParts = videoDetails.endTime ? convertFromSeconds(videoDetails.endTime) : { minutes: 0, seconds: 0 };

    return (
      <div className="space-y-4 mt-4 p-4 bg-gray-50 rounded-lg">
        <h3 className="font-medium text-gray-900 mb-3">Video Settings</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Start Time</Label>
            <div className="flex gap-2 mt-1">
              <div className="flex-1">
                <Input
                  type="number"
                  min="0"
                  value={startTimeParts.minutes}
                  onChange={(e) => {
                    const minutes = Math.max(0, parseInt(e.target.value) || 0);
                    const seconds = startTimeParts.seconds;
                    setVideoDetails({
                      ...videoDetails,
                      startTime: convertToSeconds(minutes, seconds)
                    });
                  }}
                  placeholder="0"
                  className="w-full"
                />
                <span className="text-xs text-gray-500 mt-1 block">Minutes</span>
              </div>
              <div className="flex-1">
                <Input
                  type="number"
                  min="0"
                  max="59"
                  value={startTimeParts.seconds}
                  onChange={(e) => {
                    const minutes = startTimeParts.minutes;
                    const seconds = Math.max(0, Math.min(59, parseInt(e.target.value) || 0));
                    setVideoDetails({
                      ...videoDetails,
                      startTime: convertToSeconds(minutes, seconds)
                    });
                  }}
                  placeholder="0"
                  className="w-full"
                />
                <span className="text-xs text-gray-500 mt-1 block">Seconds</span>
              </div>
            </div>
          </div>

          <div>
            <Label>End Time (optional)</Label>
            <div className="flex gap-2 mt-1">
              <div className="flex-1">
                <Input
                  type="number"
                  min="0"
                  value={endTimeParts.minutes}
                  onChange={(e) => {
                    const minutes = Math.max(0, parseInt(e.target.value) || 0);
                    const seconds = endTimeParts.seconds;
                    const totalSeconds = convertToSeconds(minutes, seconds);
                    if (totalSeconds > videoDetails.startTime) {
                      setVideoDetails({
                        ...videoDetails,
                        endTime: totalSeconds
                      });
                    }
                  }}
                  placeholder="0"
                  className="w-full"
                />
                <span className="text-xs text-gray-500 mt-1 block">Minutes</span>
              </div>
              <div className="flex-1">
                <Input
                  type="number"
                  min="0"
                  max="59"
                  value={endTimeParts.seconds}
                  onChange={(e) => {
                    const minutes = endTimeParts.minutes;
                    const seconds = Math.max(0, Math.min(59, parseInt(e.target.value) || 0));
                    const totalSeconds = convertToSeconds(minutes, seconds);
                    if (totalSeconds > videoDetails.startTime) {
                      setVideoDetails({
                        ...videoDetails,
                        endTime: totalSeconds
                      });
                    }
                  }}
                  placeholder="0"
                  className="w-full"
                />
                <span className="text-xs text-gray-500 mt-1 block">Seconds</span>
              </div>
            </div>
          </div>
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
    );
  };

  return (
    <Form.Root onSubmit={handleSubmit}>
      <div>
        <Label htmlFor="video-activity-name">Activity Name</Label>
        <Input 
          id="video-activity-name"
          value={name}
          onChange={(e) => setName(e.target.value)} 
          type="text" 
          required 
          placeholder="Enter activity name..."
        />
      </div>

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
              <div>
                <Label htmlFor="video-activity-file">Video File</Label>
                <div className="mt-2">
                  <input
                    id="video-activity-file"
                    type="file"
                    accept={SUPPORTED_FILES}
                    onChange={handleVideoChange}
                    required
                    className="w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-black file:text-white hover:file:bg-gray-800"
                  />
                </div>
              </div>
              <VideoSettingsForm />
            </div>
          )}

          {selectedView === 'youtube' && (
            <div className="space-y-4">
              <div>
                <Label htmlFor="youtube-url">YouTube URL</Label>
                <Input
                  id="youtube-url"
                  value={youtubeUrl}
                  onChange={(e) => setYoutubeUrl(e.target.value)}
                  type="text"
                  required
                  placeholder="https://youtube.com/watch?v=..."
                />
              </div>
              <VideoSettingsForm />
            </div>
          )}
        </div>
      </div>

      <div className="flex justify-end mt-6">
        <Button 
          type="submit" 
          disabled={isSubmitting}
          className="bg-black text-white hover:bg-black/90"
        >
          {isSubmitting ? (
            <BarLoader
              cssOverride={{ borderRadius: 60 }}
              width={60}
              color="#ffffff"
            />
          ) : (
            'Create Activity'
          )}
        </Button>
      </div>
    </Form.Root>
  )
}

export default VideoModal
