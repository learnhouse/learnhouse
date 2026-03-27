import FormLayout, {
  ButtonBlack,
  Flex,
  FormField,
  FormLabel,
  FormMessage,
  Input,
} from '@components/Objects/StyledElements/Form/Form'
import React, { useState, useMemo } from 'react'
import * as Form from '@radix-ui/react-form'
import BarLoader from 'react-spinners/BarLoader'
import { createLiveSessionActivity } from '@services/courses/activities'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useRouter } from 'next/navigation'

const DAYS_OF_WEEK = [
  { label: 'Mon', value: 'MO' },
  { label: 'Tue', value: 'TU' },
  { label: 'Wed', value: 'WE' },
  { label: 'Thu', value: 'TH' },
  { label: 'Fri', value: 'FR' },
  { label: 'Sat', value: 'SA' },
  { label: 'Sun', value: 'SU' },
]

function detectProviderFromUrl(url: string): string {
  try {
    const hostname = new URL(url).hostname
    if (hostname.endsWith('zoom.us')) return 'zoom'
    if (hostname === 'meet.google.com') return 'google_meet'
    if (hostname.endsWith('teams.microsoft.com') || hostname.endsWith('teams.live.com'))
      return 'teams'
  } catch {
    // invalid URL
  }
  return 'other'
}

function getProviderLabel(provider: string): string {
  switch (provider) {
    case 'zoom':
      return 'Zoom'
    case 'google_meet':
      return 'Google Meet'
    case 'teams':
      return 'Microsoft Teams'
    default:
      return ''
  }
}

function getProviderDot(provider: string): string {
  switch (provider) {
    case 'zoom':
      return 'bg-blue-500'
    case 'google_meet':
      return 'bg-green-500'
    case 'teams':
      return 'bg-purple-600'
    default:
      return ''
  }
}

function LiveSessionActivityModal({
  chapterId,
  course,
  closeModal,
}: {
  chapterId: string
  course: any
  closeModal: () => void
}) {
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const router = useRouter()

  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [startDatetime, setStartDatetime] = useState('')
  const [endDatetime, setEndDatetime] = useState('')
  const [timezone, setTimezone] = useState(
    Intl.DateTimeFormat().resolvedOptions().timeZone
  )
  const [isRecurring, setIsRecurring] = useState(false)
  const [frequency, setFrequency] = useState<'DAILY' | 'WEEKLY'>('WEEKLY')
  const [selectedDays, setSelectedDays] = useState<string[]>([])
  const [recurrenceEndDate, setRecurrenceEndDate] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const detectedProvider = useMemo(() => detectProviderFromUrl(url), [url])

  const toggleDay = (day: string) => {
    setSelectedDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
    )
  }

  const buildRRule = (): string | undefined => {
    if (!isRecurring) return undefined

    if (frequency === 'DAILY') {
      return 'FREQ=DAILY'
    }

    if (selectedDays.length === 0) {
      return 'FREQ=WEEKLY'
    }
    return `FREQ=WEEKLY;BYDAY=${selectedDays.join(',')}`
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)

    try {
      const startUTC = new Date(startDatetime).toISOString()
      const endUTC = new Date(endDatetime).toISOString()

      await createLiveSessionActivity(
        {
          name,
          chapter_id: String(chapterId),
          url,
          start_datetime: startUTC,
          end_datetime: endUTC,
          timezone,
          recurrence_rule: buildRRule(),
          recurrence_end_date: recurrenceEndDate
            ? new Date(recurrenceEndDate).toISOString()
            : undefined,
        },
        access_token
      )

      closeModal()
      router.refresh()
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <FormLayout onSubmit={handleSubmit}>
      <FormField name="live-session-name">
        <Flex className="items-baseline justify-between">
          <FormLabel>Session name</FormLabel>
          <FormMessage match="valueMissing">
            Please provide a name
          </FormMessage>
        </Flex>
        <Form.Control asChild>
          <Input
            onChange={(e: any) => setName(e.target.value)}
            type="text"
            required
            placeholder="e.g. Weekly Office Hours"
          />
        </Form.Control>
      </FormField>

      <FormField name="live-session-url">
        <Flex className="items-baseline justify-between">
          <FormLabel>Meeting URL</FormLabel>
          <FormMessage match="valueMissing">
            Please provide a meeting link
          </FormMessage>
        </Flex>
        <div className="relative">
          <Form.Control asChild>
            <Input
              onChange={(e: any) => setUrl(e.target.value)}
              type="url"
              required
              placeholder="https://zoom.us/j/..."
            />
          </Form.Control>
          {detectedProvider !== 'other' && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
              <div className={`w-2 h-2 rounded-full ${getProviderDot(detectedProvider)}`} />
              <span className="text-xs text-gray-500">
                {getProviderLabel(detectedProvider)}
              </span>
            </div>
          )}
        </div>
      </FormField>

      <div className="grid grid-cols-2 gap-3">
        <FormField name="live-session-start">
          <Flex className="items-baseline justify-between">
            <FormLabel>Start</FormLabel>
          </Flex>
          <Form.Control asChild>
            <Input
              onChange={(e: any) => setStartDatetime(e.target.value)}
              type="datetime-local"
              required
            />
          </Form.Control>
        </FormField>

        <FormField name="live-session-end">
          <Flex className="items-baseline justify-between">
            <FormLabel>End</FormLabel>
          </Flex>
          <Form.Control asChild>
            <Input
              onChange={(e: any) => setEndDatetime(e.target.value)}
              type="datetime-local"
              required
            />
          </Form.Control>
        </FormField>
      </div>

      <FormField name="live-session-timezone">
        <Flex className="items-baseline justify-between">
          <FormLabel>Timezone</FormLabel>
        </Flex>
        <Form.Control asChild>
          <Input
            value={timezone}
            onChange={(e: any) => setTimezone(e.target.value)}
            type="text"
            required
            placeholder="America/New_York"
          />
        </Form.Control>
      </FormField>

      {/* Recurring toggle */}
      <div className="flex items-center gap-2 mt-2">
        <input
          type="checkbox"
          id="recurring-toggle"
          checked={isRecurring}
          onChange={(e) => setIsRecurring(e.target.checked)}
          className="rounded"
        />
        <label htmlFor="recurring-toggle" className="text-sm text-gray-600">
          Recurring session
        </label>
      </div>

      {isRecurring && (
        <div className="space-y-3 mt-2 p-3 bg-gray-50 rounded-lg">
          <div>
            <label className="text-sm font-medium text-gray-700">Frequency</label>
            <div className="flex gap-2 mt-1">
              <button
                type="button"
                onClick={() => setFrequency('DAILY')}
                className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                  frequency === 'DAILY'
                    ? 'bg-gray-900 text-white border-gray-900'
                    : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-100'
                }`}
              >
                Daily
              </button>
              <button
                type="button"
                onClick={() => setFrequency('WEEKLY')}
                className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                  frequency === 'WEEKLY'
                    ? 'bg-gray-900 text-white border-gray-900'
                    : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-100'
                }`}
              >
                Weekly
              </button>
            </div>
          </div>

          {frequency === 'WEEKLY' && (
            <div>
              <label className="text-sm font-medium text-gray-700">On days</label>
              <div className="flex gap-1 mt-1">
                {DAYS_OF_WEEK.map((day) => (
                  <button
                    key={day.value}
                    type="button"
                    onClick={() => toggleDay(day.value)}
                    className={`w-10 h-10 text-xs rounded-lg border transition-colors ${
                      selectedDays.includes(day.value)
                        ? 'bg-gray-900 text-white border-gray-900'
                        : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-100'
                    }`}
                  >
                    {day.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <FormField name="live-session-recurrence-end">
            <Flex className="items-baseline justify-between">
              <FormLabel>End date (optional)</FormLabel>
            </Flex>
            <Form.Control asChild>
              <Input
                onChange={(e: any) => setRecurrenceEndDate(e.target.value)}
                type="date"
              />
            </Form.Control>
          </FormField>
        </div>
      )}

      <Flex className="mt-6 justify-end">
        <Form.Submit asChild>
          <ButtonBlack type="submit" className="mt-2.5">
            {isSubmitting ? (
              <BarLoader
                cssOverride={{ borderRadius: 60 }}
                width={60}
                color="#ffffff"
              />
            ) : (
              'Create live session'
            )}
          </ButtonBlack>
        </Form.Submit>
      </Flex>
    </FormLayout>
  )
}

export default LiveSessionActivityModal
